const Web3 = require('web3');
const ping = require('ping');
const WebsocketProvider = Web3.providers.WebsocketProvider;
const axios = require('axios');
const axiosRetry = require('axios-retry'); // 引入 axios-retry
const fs = require('fs');

// 自定义bnb当前的价格，用于计算usdt/busd买入卖出手续费**********需自行设置**********
const BNBSwapUSDTorBUSD = BigInt(340);
// 添加一个变量用于设置筛选门槛**********需自行设置**********
const PROFIT_THRESHOLD_Total = BigInt(5000 * 10 ** 18); // 筛选条件为近30天盈利金额大于5000 USDT/BUSD(已将bnb金额转换为usdt统计)
//bsc API key**********需自行设置**********
const API_KEY = '2AHVJAG24IBDJJW3EYWENAI4YTEVZZ7GFQ';
const API_BASE = 'https://api.bscscan.com/api';
const TRANSFER_EVENT_SIGNATURE = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// bsc节点链接**********需自行设置**********
const providerUrl = 'wss://api.dognode.com/bsc/59dc96ff7c3eca97338141099ae9975d';
const nodeHost = 'api.dognode.com';
//const providerUrl = 'ws://127.0.0.1:8546';
const PANCAKESWAP_ADDRESS = '0x10ed43c718714eb63d5aa57b78b54704e256024e';
const MULTICALL_ADDRESS = '0x13f4ea83d0bd40e75c8222255bc855a974568dd4';
const WBNB_CONTRACT_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT_CONTRACT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const BUSD_CONTRACT_ADDRESS = '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56';
const BTCB_CONTRACT_ADDRESS = '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c';
const CAKE_CONTRACT_ADDRESS = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';
const USTC_CONTRACT_ADDRESS = '0x23396cF899Ca06c4472205fC903bDB4de249D6fC';
const DAI_CONTRACT_ADDRESS = '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3';

// 设置 axios-retry
axiosRetry(axios, {
  retries: 3, // 尝试重试 3 次
  retryDelay: (retryCount) => {
    console.log(`Retrying request, attempt: ${retryCount}`);
    return retryCount * 2000; // 每次重试之间的延迟递增（例如，2 秒、4 秒、6 秒）
  },
  retryCondition: (error) => {
    if (error.response === undefined) {
      console.error('错误：未收到响应。', error.message);
      return true;
    }

    // 根据响应状态码确定是否重试
    const shouldRetry = error.response.status >= 500 && error.response.status < 600;

    if (shouldRetry) {
      console.warn(`服务器返回 ${error.response.status}，准备重试...`);
    }

    return shouldRetry;
  },
});

const websocketOptions = {
  connectionOptions: {
    reconnect: {
      auto: true,
      delay: 5000, // 尝试每 5 秒重新连接一次
      maxAttempts: 5, // 最多尝试重连 5 次
      onTimeout: false, // 不在超时后尝试重连
    },
    clientConfig: {
      maxReceivedFrameSize: 100000000,
      maxReceivedMessageSize: 100000000,
    },
  },
};

// 添加一个计数器来记录重试次数
let retryCount = 0;

// 自定义一个重试回调函数
function customReconnect(reconnectOptions) {
  return () => {
    retryCount++;
    console.log(`正在尝试重新连接，第${retryCount}次...`);
    if (retryCount > reconnectOptions.maxAttempts) {
      console.log('达到最大重试次数，放弃重试。');
      return false;
    }
    return true;
  };
}

//将自定义的回调函数应用到 websocketOptions 的 reconnect 对象
websocketOptions.connectionOptions.reconnect.shouldReconnect = customReconnect(websocketOptions.connectionOptions.reconnect);
// 将修改后的 websocketOptions 传递给 WebsocketProvider
const web3 = new Web3(new Web3.providers.WebsocketProvider(providerUrl, websocketOptions.connectionOptions));

// 获取交易哈希以便获取from地址用于usdt/busd的统计
async function fetchTransactionDetails(hash) {
  const url = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=${hash}&apikey=${API_KEY}`;
  try {
    const response = await axios.get(url);
    if (response.data.result) {
      return response.data.result;
    } else {
      throw new Error("获取交易详情时出错");
    }
  } catch (error) {
    console.error(error.message);
  }
}

async function getTransactions(address, days) {
  const now = Math.floor(Date.now() / 1000);
  const threshold = now - days * 24 * 60 * 60;
  const url = `${API_BASE}?module=account&action=txlist&address=${address}&startblock=1&endblock=99999999&sort=desc&apikey=${API_KEY}`;

  const response = await axios.get(url);

  if (response.status !== 200 || !response.data.result) {
    console.error(`Error fetching transactions for address ${address}:`, response);
    return [];
  }

  const transactions = response.data.result;
  return transactions.filter(tx => parseInt(tx.timeStamp) >= threshold);
}

function filterTransactions(transactions, days) {
  const now = Math.floor(Date.now() / 1000);
  const threshold = now - days * 24 * 60 * 60;
  return transactions.filter(tx => parseInt(tx.timeStamp) >= threshold);
}
