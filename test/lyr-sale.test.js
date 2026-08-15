const { Blockchain } = require('@ton/sandbox');
const { beginCell, toNano } = require('@ton/core');
require('@ton/test-utils');

const { compileTolk } = require('./helpers/compile');
const { LyrSale } = require('./helpers/LyrSale');
const { JettonMaster } = require('./helpers/JettonMaster');
const { JettonWallet } = require('./helpers/JettonWallet');

const LYR_PER_TON = 100;
const TON_PURCHASE_RESERVE = toNano('0.1');

describe('LYR Sale Contract', () => {
  let blockchain;
  let admin;
  let saleCode;
  let jettonMasterCode;
  let jettonWalletCode;
  let lyrMaster; // stand-in for the real (already-deployed) LYR jetton
  let sale;
  let saleLyrWallet; // sale contract's own wallet for the stand-in LYR jetton

  beforeAll(async () => {
    saleCode = await compileTolk('lyr-sale.tolk');
    jettonMasterCode = await compileTolk('test-jetton-master.tolk');
    jettonWalletCode = await compileTolk('test-jetton-wallet.tolk');
  });

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    admin = await blockchain.treasury('admin');

    lyrMaster = blockchain.openContract(
      JettonMaster.createFromConfig(
        {
          totalSupply: 0n,
          maxSupply: toNano('100000000'),
          mintable: 1,
          adminAddress: admin.address,
          content: beginCell().storeUint(0, 8).storeStringTail('LYR stand-in').endCell(),
          jettonWalletCode,
        },
        jettonMasterCode
      )
    );
    await lyrMaster.sendDeploy(admin.getSender(), toNano('0.05'));

    sale = blockchain.openContract(
      LyrSale.createFromConfig(
        {
          adminAddress: admin.address,
          lyrMasterAddress: lyrMaster.address,
          lyrWalletCode: jettonWalletCode,
          lyrPerTon: LYR_PER_TON,
          paused: false,
        },
        saleCode
      )
    );
  });

  async function deploySaleWithVault(vaultLyrAmount) {
    await sale.sendDeploy(admin.getSender(), toNano('0.05'));

    saleLyrWallet = blockchain.openContract(
      JettonWallet.createFromConfig({ ownerAddress: sale.address, jettonMasterAddress: lyrMaster.address }, jettonWalletCode)
    );

    if (vaultLyrAmount > 0n) {
      await lyrMaster.sendMint(admin.getSender(), { value: toNano('0.15'), toAddress: sale.address, jettonAmount: vaultLyrAmount });
    }
  }

  it('deploys with the configured admin, vault wallet, and rate', async () => {
    await deploySaleWithVault(0n);
    const data = await sale.getSaleData();
    expect(data.adminAddress.equals(admin.address)).toBe(true);
    expect(data.lyrWalletAddress.equals(saleLyrWallet.address)).toBe(true);
    expect(data.lyrPerTon).toBe(LYR_PER_TON);
    expect(data.paused).toBe(0);
  });

  // ---- Buying with native TON ----

  it('pays out 100 LYR per 1 TON, net of the gas reserve, on a plain (empty-body) TON purchase', async () => {
    await deploySaleWithVault(toNano('1000000'));
    const buyer = await blockchain.treasury('buyer');

    const sentValue = toNano('1');
    const result = await sale.sendBuyWithTon(buyer.getSender(), { value: sentValue });
    expect(result.transactions).toHaveTransaction({ from: buyer.address, to: sale.address, success: true });

    const buyerLyrWallet = blockchain.openContract(
      JettonWallet.createFromConfig({ ownerAddress: buyer.address, jettonMasterAddress: lyrMaster.address }, jettonWalletCode)
    );
    const netValue = sentValue - TON_PURCHASE_RESERVE;
    const expectedLyr = netValue * BigInt(LYR_PER_TON);
    expect((await buyerLyrWallet.getWalletData()).balance).toBe(expectedLyr);
  });

  it('also accepts a TON purchase sent as a single text comment', async () => {
    await deploySaleWithVault(toNano('1000000'));
    const buyer = await blockchain.treasury('buyer');

    const sentValue = toNano('2');
    const result = await sale.sendBuyWithTonComment(buyer.getSender(), { value: sentValue, comment: 'buy' });
    expect(result.transactions).toHaveTransaction({ from: buyer.address, to: sale.address, success: true });

    const buyerLyrWallet = blockchain.openContract(
      JettonWallet.createFromConfig({ ownerAddress: buyer.address, jettonMasterAddress: lyrMaster.address }, jettonWalletCode)
    );
    const expectedLyr = (sentValue - TON_PURCHASE_RESERVE) * BigInt(LYR_PER_TON);
    expect((await buyerLyrWallet.getWalletData()).balance).toBe(expectedLyr);
  });

  it('rejects a TON purchase that does not cover the gas reserve', async () => {
    await deploySaleWithVault(toNano('1000000'));
    const buyer = await blockchain.treasury('buyer');

    const result = await sale.sendBuyWithTon(buyer.getSender(), { value: toNano('0.05') });
    expect(result.transactions).toHaveTransaction({ to: sale.address, success: false });
  });

  it('rejects a TON purchase while paused', async () => {
    await deploySaleWithVault(toNano('1000000'));
    await sale.sendSetPaused(admin.getSender(), { value: toNano('0.02'), paused: true });

    const buyer = await blockchain.treasury('buyer');
    const result = await sale.sendBuyWithTon(buyer.getSender(), { value: toNano('1') });
    expect(result.transactions).toHaveTransaction({ to: sale.address, success: false });

    const data = await sale.getSaleData();
    expect(data.paused).toBe(1);
  });

  it('respects an updated TON rate', async () => {
    await deploySaleWithVault(toNano('1000000'));
    await sale.sendSetTonRate(admin.getSender(), { value: toNano('0.02'), newRate: 50 });

    const buyer = await blockchain.treasury('buyer');
    const sentValue = toNano('1');
    await sale.sendBuyWithTon(buyer.getSender(), { value: sentValue });

    const buyerLyrWallet = blockchain.openContract(
      JettonWallet.createFromConfig({ ownerAddress: buyer.address, jettonMasterAddress: lyrMaster.address }, jettonWalletCode)
    );
    const expectedLyr = (sentValue - TON_PURCHASE_RESERVE) * 50n;
    expect((await buyerLyrWallet.getWalletData()).balance).toBe(expectedLyr);
  });

  // ---- Buying with an approved jetton ----

  async function deployPaymentJetton() {
    const paymentMaster = blockchain.openContract(
      JettonMaster.createFromConfig(
        {
          totalSupply: 0n,
          maxSupply: toNano('1000000000'),
          mintable: 1,
          adminAddress: admin.address,
          content: beginCell().storeUint(0, 8).storeStringTail('Payment jetton stand-in').endCell(),
          jettonWalletCode,
        },
        jettonMasterCode
      )
    );
    await paymentMaster.sendDeploy(admin.getSender(), toNano('0.05'));
    return paymentMaster;
  }

  it('approves a jetton, pays out LYR at the admin-set rate, and rejects the same jetton before approval', async () => {
    await deploySaleWithVault(toNano('1000000'));
    const paymentMaster = await deployPaymentJetton();
    const buyer = await blockchain.treasury('buyer');

    await paymentMaster.sendMint(admin.getSender(), { value: toNano('0.15'), toAddress: buyer.address, jettonAmount: toNano('1000') });
    const buyerPaymentWallet = blockchain.openContract(
      JettonWallet.createFromConfig({ ownerAddress: buyer.address, jettonMasterAddress: paymentMaster.address }, jettonWalletCode)
    );

    // Before approval: transfer_notification reaches the sale contract but is rejected.
    const preApprovalResult = await buyerPaymentWallet.sendTransfer(buyer.getSender(), {
      value: toNano('0.3'),
      jettonAmount: toNano('100'),
      destination: sale.address,
      responseDestination: buyer.address,
      forwardTonAmount: toNano('0.1'),
    });
    expect(preApprovalResult.transactions).toHaveTransaction({ to: sale.address, success: false });

    // rateNumerator/rateDenominator chosen so 1 payment-jetton (9 decimals) == 0.5 TON-equivalent == 50 LYR.
    const rateNumerator = 50n * 1_000_000_000n;
    const rateDenominator = 1_000_000_000n;
    await sale.sendApproveJetton(admin.getSender(), {
      value: toNano('0.05'),
      jettonMasterAddress: paymentMaster.address,
      jettonWalletCode,
      rateNumerator,
      rateDenominator,
    });

    const salePaymentWalletAddress = JettonWallet.computeAddress(sale.address, paymentMaster.address, jettonWalletCode);
    const rate = await sale.getJettonRate(salePaymentWalletAddress);
    expect(rate.found).toBe(true);
    expect(rate.enabled).toBe(true);

    const purchaseAmount = toNano('10'); // 10 payment-jettons
    const result = await buyerPaymentWallet.sendTransfer(buyer.getSender(), {
      value: toNano('0.3'),
      jettonAmount: purchaseAmount,
      destination: sale.address,
      responseDestination: buyer.address,
      forwardTonAmount: toNano('0.1'),
    });
    expect(result.transactions).toHaveTransaction({ to: sale.address, success: true });

    const buyerLyrWallet = blockchain.openContract(
      JettonWallet.createFromConfig({ ownerAddress: buyer.address, jettonMasterAddress: lyrMaster.address }, jettonWalletCode)
    );
    const expectedLyr = (purchaseAmount * rateNumerator) / rateDenominator;
    expect((await buyerLyrWallet.getWalletData()).balance).toBe(expectedLyr);
  });

  it('stops paying out for a disabled jetton', async () => {
    await deploySaleWithVault(toNano('1000000'));
    const paymentMaster = await deployPaymentJetton();
    const buyer = await blockchain.treasury('buyer');

    await sale.sendApproveJetton(admin.getSender(), {
      value: toNano('0.05'),
      jettonMasterAddress: paymentMaster.address,
      jettonWalletCode,
      rateNumerator: 1n,
      rateDenominator: 1n,
    });
    const salePaymentWalletAddress = JettonWallet.computeAddress(sale.address, paymentMaster.address, jettonWalletCode);
    await sale.sendDisableJetton(admin.getSender(), { value: toNano('0.02'), jettonWalletAddress: salePaymentWalletAddress });

    await paymentMaster.sendMint(admin.getSender(), { value: toNano('0.15'), toAddress: buyer.address, jettonAmount: toNano('100') });
    const buyerPaymentWallet = blockchain.openContract(
      JettonWallet.createFromConfig({ ownerAddress: buyer.address, jettonMasterAddress: paymentMaster.address }, jettonWalletCode)
    );
    const result = await buyerPaymentWallet.sendTransfer(buyer.getSender(), {
      value: toNano('0.3'),
      jettonAmount: toNano('10'),
      destination: sale.address,
      responseDestination: buyer.address,
      forwardTonAmount: toNano('0.1'),
    });
    expect(result.transactions).toHaveTransaction({ to: sale.address, success: false });
  });

  // ---- Admin authorization ----

  it('rejects admin ops from a non-admin sender', async () => {
    await deploySaleWithVault(toNano('1000000'));
    const stranger = await blockchain.treasury('stranger');

    const result = await sale.sendSetTonRate(stranger.getSender(), { value: toNano('0.02'), newRate: 1 });
    expect(result.transactions).toHaveTransaction({ to: sale.address, success: false });

    const data = await sale.getSaleData();
    expect(data.lyrPerTon).toBe(LYR_PER_TON); // unchanged
  });

  it('lets the admin withdraw accumulated TON revenue', async () => {
    await deploySaleWithVault(toNano('1000000'));
    const buyer = await blockchain.treasury('buyer');
    await sale.sendBuyWithTon(buyer.getSender(), { value: toNano('5') });

    const recipient = await blockchain.treasury('recipient');
    const before = await blockchain.getContract(recipient.address);
    const beforeBalance = before.balance;

    const result = await sale.sendWithdrawTon(admin.getSender(), { value: toNano('0.02'), amount: toNano('1'), to: recipient.address });
    expect(result.transactions).toHaveTransaction({ to: recipient.address, success: true, value: toNano('1') });

    const after = await blockchain.getContract(recipient.address);
    expect(after.balance).toBeGreaterThan(beforeBalance);
  });
});
