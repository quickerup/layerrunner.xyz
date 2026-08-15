const { beginCell, contractAddress, Dictionary } = require('@ton/core');

const OP_ADMIN_APPROVE_JETTON = 0x4a1e9f10;
const OP_ADMIN_DISABLE_JETTON = 0x5b2f0a21;
const OP_ADMIN_SET_TON_RATE = 0x6c301b32;
const OP_ADMIN_SET_ADMIN = 0x7d412c43;
const OP_ADMIN_SET_PAUSED = 0x8e523d54;
const OP_ADMIN_WITHDRAW_TON = 0x9f634e65;
const OP_ADMIN_WITHDRAW_JETTON = 0xa0745f76;

function configToCell(config) {
  return beginCell()
    .storeAddress(config.adminAddress)
    .storeAddress(config.lyrMasterAddress)
    .storeRef(config.lyrWalletCode)
    .storeUint(config.lyrPerTon, 32)
    .storeUint(config.paused ? 1 : 0, 1)
    .storeDict(null)
    .endCell();
}

class LyrSale {
  constructor(address, init) {
    this.address = address;
    this.init = init;
  }

  static createFromConfig(config, code, workchain = 0) {
    const data = configToCell(config);
    const init = { code, data };
    const address = contractAddress(workchain, init);
    return new LyrSale(address, init);
  }

  /** Deploy is itself a real admin op (set-paused, idempotent) — not an
   *  empty-body message, so it can never collide with buy-with-TON's
   *  empty-body/text-comment path (see lyr-sale.tolk's onInternalMessage). */
  async sendDeploy(provider, via, value) {
    await provider.internal(via, {
      value,
      body: beginCell().storeUint(OP_ADMIN_SET_PAUSED, 32).storeUint(0, 1).endCell(),
    });
  }

  async sendBuyWithTon(provider, via, { value }) {
    await provider.internal(via, { value, body: beginCell().endCell() });
  }

  async sendBuyWithTonComment(provider, via, { value, comment = 'buy' }) {
    await provider.internal(via, {
      value,
      body: beginCell().storeUint(0, 32).storeStringTail(comment).endCell(),
    });
  }

  async sendApproveJetton(provider, via, { value, jettonMasterAddress, jettonWalletCode, rateNumerator, rateDenominator }) {
    await provider.internal(via, {
      value,
      body: beginCell()
        .storeUint(OP_ADMIN_APPROVE_JETTON, 32)
        .storeAddress(jettonMasterAddress)
        .storeRef(jettonWalletCode)
        .storeCoins(rateNumerator)
        .storeCoins(rateDenominator)
        .endCell(),
    });
  }

  async sendDisableJetton(provider, via, { value, jettonWalletAddress }) {
    await provider.internal(via, {
      value,
      body: beginCell().storeUint(OP_ADMIN_DISABLE_JETTON, 32).storeAddress(jettonWalletAddress).endCell(),
    });
  }

  async sendSetTonRate(provider, via, { value, newRate }) {
    await provider.internal(via, {
      value,
      body: beginCell().storeUint(OP_ADMIN_SET_TON_RATE, 32).storeUint(newRate, 32).endCell(),
    });
  }

  async sendSetAdmin(provider, via, { value, newAdmin }) {
    await provider.internal(via, {
      value,
      body: beginCell().storeUint(OP_ADMIN_SET_ADMIN, 32).storeAddress(newAdmin).endCell(),
    });
  }

  async sendSetPaused(provider, via, { value, paused }) {
    await provider.internal(via, {
      value,
      body: beginCell().storeUint(OP_ADMIN_SET_PAUSED, 32).storeUint(paused ? 1 : 0, 1).endCell(),
    });
  }

  async sendWithdrawTon(provider, via, { value, amount, to }) {
    await provider.internal(via, {
      value,
      body: beginCell().storeUint(OP_ADMIN_WITHDRAW_TON, 32).storeCoins(amount).storeAddress(to).endCell(),
    });
  }

  async sendWithdrawJetton(provider, via, { value, jettonWalletAddress, amount, to }) {
    await provider.internal(via, {
      value,
      body: beginCell()
        .storeUint(OP_ADMIN_WITHDRAW_JETTON, 32)
        .storeAddress(jettonWalletAddress)
        .storeCoins(amount)
        .storeAddress(to)
        .endCell(),
    });
  }

  /** Used to test unauthorized/malformed ops directly. */
  async sendRaw(provider, via, { value, body, bounce }) {
    await provider.internal(via, { value, body, bounce });
  }

  async getSaleData(provider) {
    const result = await provider.get('get_sale_data', []);
    return {
      adminAddress: result.stack.readAddress(),
      lyrMasterAddress: result.stack.readAddress(),
      lyrWalletAddress: result.stack.readAddress(),
      lyrPerTon: result.stack.readNumber(),
      paused: result.stack.readNumber(),
    };
  }

  async getJettonRate(provider, jettonWalletAddress) {
    const result = await provider.get('get_jetton_rate', [
      { type: 'slice', cell: beginCell().storeAddress(jettonWalletAddress).endCell() },
    ]);
    const found = result.stack.readNumber();
    const rateNumerator = result.stack.readBigNumber();
    const rateDenominator = result.stack.readBigNumber();
    const enabled = result.stack.readNumber();
    return { found: found === 1, rateNumerator, rateDenominator, enabled: enabled === 1 };
  }
}

module.exports = {
  LyrSale,
  OP_ADMIN_APPROVE_JETTON,
  OP_ADMIN_DISABLE_JETTON,
  OP_ADMIN_SET_TON_RATE,
  OP_ADMIN_SET_ADMIN,
  OP_ADMIN_SET_PAUSED,
  OP_ADMIN_WITHDRAW_TON,
  OP_ADMIN_WITHDRAW_JETTON,
};
