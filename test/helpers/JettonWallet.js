const { beginCell, contractAddress } = require('@ton/core');

const OP_TRANSFER = 0x0f8a7ea5;
const OP_TRANSFER_NOTIFICATION = 0x7362d09c;
const OP_INTERNAL_TRANSFER = 0x178d4519;
const OP_EXCESSES = 0xd53276db;
const OP_BURN = 0x595f07bc;
const OP_BURN_NOTIFICATION = 0x7bdd97de;

/** Mirrors jetton-utils.tolk's storeForwardPayload/loadForwardPayload: bit=1+ref if a
 *  payload cell is given, else bit=0 with nothing following (empty inline payload). */
function storeForwardPayload(builder, payloadCell) {
  if (payloadCell) {
    return builder.storeUint(1, 1).storeRef(payloadCell);
  }
  return builder.storeUint(0, 1);
}

function walletDataCell(ownerAddress, jettonMasterAddress) {
  return beginCell().storeCoins(0).storeAddress(ownerAddress).storeAddress(jettonMasterAddress).endCell();
}

class JettonWallet {
  constructor(address, init) {
    this.address = address;
    this.init = init;
  }

  static createFromConfig(config, code, workchain = 0) {
    const data = walletDataCell(config.ownerAddress, config.jettonMasterAddress);
    const init = { code, data };
    const address = contractAddress(workchain, init);
    return new JettonWallet(address, init);
  }

  static computeAddress(ownerAddress, jettonMasterAddress, code, workchain = 0) {
    const data = walletDataCell(ownerAddress, jettonMasterAddress);
    return contractAddress(workchain, { code, data });
  }

  async sendTransfer(
    provider,
    via,
    { value, queryId = 0, jettonAmount, destination, responseDestination, customPayload = null, forwardTonAmount = 0n, forwardPayload = null }
  ) {
    let b = beginCell()
      .storeUint(OP_TRANSFER, 32)
      .storeUint(queryId, 64)
      .storeCoins(jettonAmount)
      .storeAddress(destination)
      .storeAddress(responseDestination);
    b = customPayload ? b.storeUint(1, 1).storeRef(customPayload) : b.storeUint(0, 1);
    b = b.storeCoins(forwardTonAmount);
    b = storeForwardPayload(b, forwardPayload);
    await provider.internal(via, { value, body: b.endCell() });
  }

  async sendBurn(provider, via, { value, queryId = 0, jettonAmount, responseDestination, customPayload = null }) {
    let b = beginCell().storeUint(OP_BURN, 32).storeUint(queryId, 64).storeCoins(jettonAmount).storeAddress(responseDestination);
    b = customPayload ? b.storeUint(1, 1).storeRef(customPayload) : b.storeUint(0, 1);
    await provider.internal(via, { value, body: b.endCell() });
  }

  /** Sends a raw internal_transfer directly — used to test sender validation
   *  (only the master or a genuine sibling wallet should be able to credit a wallet). */
  async sendInternalTransfer(
    provider,
    via,
    { value, queryId = 0, jettonAmount, fromAddress, responseAddress, forwardTonAmount = 0n, forwardPayload = null, bounce }
  ) {
    let b = beginCell()
      .storeUint(OP_INTERNAL_TRANSFER, 32)
      .storeUint(queryId, 64)
      .storeCoins(jettonAmount)
      .storeAddress(fromAddress)
      .storeAddress(responseAddress)
      .storeCoins(forwardTonAmount);
    b = storeForwardPayload(b, forwardPayload);
    await provider.internal(via, { value, body: b.endCell(), bounce });
  }

  async sendRaw(provider, via, { value, body, bounce }) {
    await provider.internal(via, { value, body, bounce });
  }

  async getWalletData(provider) {
    const result = await provider.get('get_wallet_data', []);
    return {
      balance: result.stack.readBigNumber(),
      ownerAddress: result.stack.readAddress(),
      jettonMasterAddress: result.stack.readAddress(),
      jettonWalletCode: result.stack.readCell(),
    };
  }
}

module.exports = {
  JettonWallet,
  OP_TRANSFER,
  OP_TRANSFER_NOTIFICATION,
  OP_INTERNAL_TRANSFER,
  OP_EXCESSES,
  OP_BURN,
  OP_BURN_NOTIFICATION,
  walletDataCell,
};
