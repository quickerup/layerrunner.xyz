const { Address, beginCell, Cell, contractAddress } = require('@ton/core');

const OP_MINT = 0x642b7d07;
const OP_BURN_NOTIFICATION = 0x7bdd97de;
const OP_PROVIDE_WALLET_ADDRESS = 0x2c76b973;
const OP_TAKE_WALLET_ADDRESS = 0xd1735400;
const OP_SET_ADMIN = 0x39702640;
const OP_REVOKE_MINT = 0x5f8a0f2d;

function configToCell(config) {
  return beginCell()
    .storeCoins(config.totalSupply)
    .storeCoins(config.maxSupply)
    .storeUint(config.mintable, 1)
    .storeAddress(config.adminAddress)
    .storeRef(config.content)
    .storeRef(config.jettonWalletCode)
    .endCell();
}

class JettonMaster {
  constructor(address, init) {
    this.address = address;
    this.init = init;
  }

  static createFromConfig(config, code, workchain = 0) {
    const data = configToCell(config);
    const init = { code, data };
    const address = contractAddress(workchain, init);
    return new JettonMaster(address, init);
  }

  async sendDeploy(provider, via, value) {
    await provider.internal(via, { value, bounce: false, body: beginCell().endCell() });
  }

  async sendMint(provider, via, { value, queryId = 0, toAddress, jettonAmount, forwardTonAmount = 0n }) {
    await provider.internal(via, {
      value,
      body: beginCell()
        .storeUint(OP_MINT, 32)
        .storeUint(queryId, 64)
        .storeAddress(toAddress)
        .storeCoins(jettonAmount)
        .storeCoins(forwardTonAmount)
        .endCell(),
    });
  }

  async sendProvideWalletAddress(provider, via, { value, queryId = 0, ownerAddress, includeAddress = false }) {
    await provider.internal(via, {
      value,
      body: beginCell()
        .storeUint(OP_PROVIDE_WALLET_ADDRESS, 32)
        .storeUint(queryId, 64)
        .storeAddress(ownerAddress)
        .storeUint(includeAddress ? 1 : 0, 1)
        .endCell(),
    });
  }

  async sendSetAdmin(provider, via, { value, newAdmin }) {
    await provider.internal(via, {
      value,
      body: beginCell().storeUint(OP_SET_ADMIN, 32).storeAddress(newAdmin).endCell(),
    });
  }

  async sendRevokeMint(provider, via, { value }) {
    await provider.internal(via, {
      value,
      body: beginCell().storeUint(OP_REVOKE_MINT, 32).endCell(),
    });
  }

  /** Sends an arbitrary raw message body — used to test unauthorized/malformed ops. */
  async sendRaw(provider, via, { value, body, bounce }) {
    await provider.internal(via, { value, body, bounce });
  }

  async getJettonData(provider) {
    const result = await provider.get('get_jetton_data', []);
    return {
      totalSupply: result.stack.readBigNumber(),
      mintable: result.stack.readNumber(),
      adminAddress: result.stack.readAddress(),
      content: result.stack.readCell(),
      jettonWalletCode: result.stack.readCell(),
    };
  }

  async getMaxSupply(provider) {
    const result = await provider.get('get_max_supply', []);
    return result.stack.readBigNumber();
  }

  async getWalletAddress(provider, ownerAddress) {
    const result = await provider.get('get_wallet_address', [
      { type: 'slice', cell: beginCell().storeAddress(ownerAddress).endCell() },
    ]);
    return result.stack.readAddress();
  }
}

module.exports = {
  JettonMaster,
  OP_MINT,
  OP_BURN_NOTIFICATION,
  OP_PROVIDE_WALLET_ADDRESS,
  OP_TAKE_WALLET_ADDRESS,
  OP_SET_ADMIN,
  OP_REVOKE_MINT,
};
