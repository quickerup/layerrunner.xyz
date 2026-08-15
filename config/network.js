require('dotenv').config();

const NETWORK = process.env.DEPLOY_NETWORK || 'testnet';

if (NETWORK === 'mainnet' && process.env.CONFIRM_MAINNET !== 'true') {
  throw new Error(
    'DEPLOY_NETWORK=mainnet requires CONFIRM_MAINNET=true in .env — refusing to run against mainnet by accident.'
  );
}

const config = {
  testnet: {
    network: 'testnet',
    apiUrl: process.env.TONCENTER_API_URL_TESTNET || 'https://testnet.toncenter.com/api/v2',
    apiKey: process.env.TONCENTER_API_KEY_TESTNET || '',
  },
  mainnet: {
    network: 'mainnet',
    apiUrl: process.env.TONCENTER_API_URL_MAINNET || 'https://toncenter.com/api/v2',
    apiKey: process.env.TONCENTER_API_KEY || '',
  },
};

module.exports = config[NETWORK];
