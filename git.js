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

async function processTransactions(address, transactions, days, outputFile) {
  console.log(`\n查询 ${days} 天内的交易`);

  //bnb交易变量(未修改)=================================
  let totalBuyCount = 0;
  let totalBuyAmount = BigInt(0);
  let totalBuyFee = BigInt(0);
  let totalSellCount = 0;
  let totalSellAmount = BigInt(0);
  let totalSellFee = BigInt(0);

  //usdt或者BUSD交易变量(新增)=================================
  let totalBuyCountUSDTorBUSD = 0;
  let totalBuyAmountUSDTorBUSD = BigInt(0);
  let totalBuyFeeUSDTorBUSD = BigInt(0);
  let totalSellCountUSDTorBUSD = 0;
  let totalSellAmountUSDTorBUSD = BigInt(0);
  let totalSellFeeUSDTorBUSD = BigInt(0);

  let index = 1;
  for (const tx of transactions) {
    console.log(`\n[${index}] 交易哈希: ${tx.hash}`);

    //从交易哈希详情里面获取from地址，txDetails.from=================================
    const txDetails = await fetchTransactionDetails(tx.hash);
    console.log('交易详细信息:', JSON.stringify(tx, null, 2));
    //const methodId = txDetails.input.slice(0, 10);
    //console.log(`    交易哈希内的From 地址: ${txDetails.from}`);
    //console.log(`    交易哈希内的To 地址: ${txDetails.to}`);
    index++;

    const receipt = await web3.eth.getTransactionReceipt(tx.hash);
    const gasUsed = BigInt(receipt.gasUsed);
    const txData = await web3.eth.getTransaction(tx.hash);
    const gasPrice = BigInt(txData.gasPrice);
    const transactionFee = gasUsed * gasPrice;

    const transferEvents = receipt.logs.filter(log => log.topics[0] === TRANSFER_EVENT_SIGNATURE);
    //方便查找没匹配上的交易哈希
    let foundMatchingCondition = false;
    //方便查找同一transfer事件多次匹配的情况
    //排除0条、1条、2条、3条、4条且swap的transfer事件，只判断2条且不是swap或者超过2条的transfer事件
    const isValidAddress = (address) => {
      const lowerCaseAddress = address.toLowerCase();
      const contractAddresses = [
        WBNB_CONTRACT_ADDRESS,
        USDT_CONTRACT_ADDRESS,
        BUSD_CONTRACT_ADDRESS,
        BTCB_CONTRACT_ADDRESS,
        CAKE_CONTRACT_ADDRESS,
        USTC_CONTRACT_ADDRESS,
        DAI_CONTRACT_ADDRESS
      ];

      return contractAddresses.some(contract => lowerCaseAddress === contract.toLowerCase());
    };
    const isSwapTransaction = (transferEvents.length >= 2 && transferEvents.every(event => isValidAddress(event.address))) || (transferEvents.length === 0 || transferEvents.length === 1);
    let shouldHandleBuySellTransaction = !isSwapTransaction;

    if (transferEvents.length === 0) {
      console.log("    此条交易哈希没有Transfer事件");
    } else if (transferEvents.length === 1) {
      console.log("    此条交易哈希只有一条Transfer事件");
    } else if (isSwapTransaction) {
      console.log("    此条交易哈希有2条或3条或4条Transfer事件且是swap交易，跳过判断买入卖出");
    } else if (transferEvents.length === 2) {
      console.log("    此条交易哈希有2条Transfer事件，但不是swap交易，继续买入卖出判断");
    } else {
      console.log("    此条交易哈希有多于两条Transfer事件，继续买入卖出判断");
    }

    let matchingConditionCount = 0;
    if (shouldHandleBuySellTransaction) {
      const halfLength = Math.ceil(transferEvents.length / 2);
      const maxRowsPerJudgment = 2; // 您可以通过修改这个值来控制每个判断操作最多检查多少行
      const buyIndices = Array.from({ length: halfLength }, (_, i) => i);
      const sellIndices = Array.from({ length: halfLength }, (_, i) => transferEvents.length - 1 - i);

      for (let i = 0; i < transferEvents.length; i++) {
        const event = transferEvents[i];
        const from = '0x' + event.topics[1].slice(-40);
        const to = '0x' + event.topics[2].slice(-40);
        const value = web3.utils.hexToNumberString(event.data);
        const valueInEther = web3.utils.fromWei(value, 'ether');
        console.log(`    Transfer 事件：From ${from} To ${to} Value ${valueInEther} 代币合约地址: ${event.address}`);

        if (buyIndices.includes(i) && i < maxRowsPerJudgment) {
          if (event.address.toLowerCase() === WBNB_CONTRACT_ADDRESS.toLowerCase() && (from === PANCAKESWAP_ADDRESS || from === MULTICALL_ADDRESS || from === txDetails.to)) {
            console.log(`    >>>>>>BNB买入交易: 买入金额 ${valueInEther} BNB, 手续费 ${web3.utils.fromWei(transactionFee.toString(), 'ether')} BNB<<<<<<`);
            totalBuyCount++;
            totalBuyAmount += BigInt(value);
            totalBuyFee += transactionFee;
            //查找不匹配或多次匹配情况
            foundMatchingCondition = true;
            matchingConditionCount++;
            continue;
          } else if ((event.address.toLowerCase() === USDT_CONTRACT_ADDRESS.toLowerCase() || event.address.toLowerCase() === BUSD_CONTRACT_ADDRESS.toLowerCase()) && (from === txDetails.from || from === txDetails.to)) {
            console.log(`    >>>>>>USDT/BUSD买入交易: 买入金额 ${valueInEther} USDT/BUSD, 手续费 ${web3.utils.fromWei(transactionFee.toString(), 'ether')} BNB<<<<<<`);
            totalBuyCountUSDTorBUSD++;
            totalBuyAmountUSDTorBUSD += BigInt(value);
            totalBuyFeeUSDTorBUSD += transactionFee;
            //查找不匹配或多次匹配情况
            foundMatchingCondition = true;
            matchingConditionCount++;
            continue;
          }
        } else if (sellIndices.includes(i) && i >= transferEvents.length - maxRowsPerJudgment) {
          if (event.address.toLowerCase() === WBNB_CONTRACT_ADDRESS.toLowerCase() && (to === PANCAKESWAP_ADDRESS || to === MULTICALL_ADDRESS || to === txDetails.to)) {
            console.log(`    >>>>>>BNB卖出交易: 卖出金额 ${valueInEther} BNB, 手续费 ${web3.utils.fromWei(transactionFee.toString(), 'ether')} BNB<<<<<<`);
            totalSellCount++;
            totalSellAmount += BigInt(value);
            totalSellFee += transactionFee;
            //查找不匹配或多次匹配情况
            foundMatchingCondition = true;
            matchingConditionCount++;
            continue;
          } else if ((event.address.toLowerCase() === USDT_CONTRACT_ADDRESS.toLowerCase() || event.address.toLowerCase() === BUSD_CONTRACT_ADDRESS.toLowerCase()) && (to === txDetails.from || to === txDetails.to)) {
            console.log(`    >>>>>>USDT/BUSD卖出交易: 卖出金额 ${valueInEther} USDT/BUSD, 手续费 ${web3.utils.fromWei(transactionFee.toString(), 'ether')} BNB<<<<<<`);
            totalSellCountUSDTorBUSD++;
            totalSellAmountUSDTorBUSD += BigInt(value);
            totalSellFeeUSDTorBUSD += transactionFee;
            //查找不匹配或多次匹配情况
            foundMatchingCondition = true;
            matchingConditionCount++;
            continue;
          }
        }
      }
      // 如果遍历完所有 transferEvents 仍然没有找到匹配条件
      if (!foundMatchingCondition) {
        console.log("    买入卖出条件不匹配");
      } else if (matchingConditionCount > 1) {
        console.log("    买入卖出条件匹配数量错误");
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const netProfit = totalSellAmount - totalBuyAmount - totalBuyFee - totalSellFee;
  const netProfitUSDTorBUSD = totalSellAmountUSDTorBUSD - totalBuyAmountUSDTorBUSD - totalBuyFeeUSDTorBUSD * BNBSwapUSDTorBUSD - totalSellFeeUSDTorBUSD * BNBSwapUSDTorBUSD;
  const totalNetProfit = netProfit * BNBSwapUSDTorBUSD + netProfitUSDTorBUSD;
  const summary = `\n查询完毕，该地址在 ${days} 天内\n\nBNB统计结果：\nBNB买入次数共计 ${totalBuyCount} 次，BNB买入金额共计 ${web3.utils.fromWei(totalBuyAmount.toString(), 'ether')} BNB，BNB买入手续费共计 ${web3.utils.fromWei(totalBuyFee.toString(), 'ether')} BNB\nBNB卖出次数共计 ${totalSellCount} 次，BNB卖出金额共计 ${web3.utils.fromWei(totalSellAmount.toString(), 'ether')} BNB，BNB卖出手续费共计 ${web3.utils.fromWei(totalSellFee.toString(), 'ether')} BNB\n${days}天内盈利金额BNB = ${web3.utils.fromWei(netProfit.toString(), 'ether')} BNB(已扣除买卖手续费)。\n\nUSDT/BUSD统计结果：\nUSDT/BUSD买入次数共计 ${totalBuyCountUSDTorBUSD} 次，USDT/BUSD买入金额共计 ${web3.utils.fromWei(totalBuyAmountUSDTorBUSD.toString(), 'ether')} USDT/BUSD，USDT/BUSD买入手续费共计 ${web3.utils.fromWei(totalBuyFeeUSDTorBUSD.toString(), 'ether')} BNB\nUSDT/BUSD卖出次数共计 ${totalSellCountUSDTorBUSD} 次，USDT/BUSD卖出金额共计 ${web3.utils.fromWei(totalSellAmountUSDTorBUSD.toString(), 'ether')} USDT/BUSD，USDT/BUSD卖出手续费共计 ${web3.utils.fromWei(totalSellFeeUSDTorBUSD.toString(), 'ether')} BNB\n${days}天内盈利USDT/BUSD金额 = ${web3.utils.fromWei(netProfitUSDTorBUSD.toString(), 'ether')} USDT/BUSD(已扣除买卖手续费)。\n\n>>>${days}天内总计结果：\n>>>${days}天内总盈利金额(包含BNB/USDT/BUSD) = ${web3.utils.fromWei(totalNetProfit.toString(), 'ether')} USDT(已扣除买卖手续费)。\n`;

  // 输出到控制台
  console.log(summary);

  // 检查是否达到筛选门槛
  if (days === 30 && totalNetProfit > PROFIT_THRESHOLD_Total) {
    // 将结果追加到输出文件
    if (outputFile) {
      fs.appendFileSync(outputFile, `\n查询 ${days} 天内的交易:\n`);
      fs.appendFileSync(outputFile, summary);
    }
  }
}

async function main() {
  // 检查节点同步状态并输出延迟
  const checkSyncStatusAndLatency = async () => {
    const syncing = await web3.eth.isSyncing();
    console.log('同步状态:', syncing);
    if (syncing) {
      console.log('节点仍在同步，请等待同步完成后再运行脚本。');
      return;
    }
    const pingResponse = await ping.promise.probe(nodeHost);
    if (pingResponse.alive) {
      console.log('当前连接节点的延迟:', pingResponse.avg, '毫秒');
    } else {
      console.log('无法测量节点延迟。');
    }
  };
  checkSyncStatusAndLatency();

  // 定义文件名列表
  const files = [
    { inputFile: './out_pancake_hold100_tx1000.txt', outputFile: './out_pancake_hold100_tx1000_30daysProfit.txt' },
    { inputFile: './out_multicall_hold100_tx1000.txt', outputFile: './out_multicall_hold100_tx1000_30daysProfit.txt' },
    { inputFile: './out_private_hold100_tx1000.txt', outputFile: './out_private_hold100_tx1000_30daysProfit.txt' },
  ];

  // 遍历文件名列表，读取并合并所有文件中的地址
  let addressEntries = [];
  for (const file of files) {
    console.log(`正在查询文件: ${file.inputFile}`); // 输出当前正在查询的文件名
    const fileAddresses = fs.readFileSync(file.inputFile, 'utf-8').split('\n').filter(Boolean);
    const fileAddressEntries = fileAddresses.map(addr => ({ address: addr, outputFile: file.outputFile }));
    addressEntries = addressEntries.concat(fileAddressEntries);
  }

  let addressIndex = 1;
  for (const entry of addressEntries) {
    const address = entry.address;
    const outputFile = entry.outputFile;
    console.log(`\n正在查询地址：${address}`);
    const transactions30days = await getTransactions(address, 30);
    console.log(`该地址30天内交易数量: ${transactions30days.length}`);
    // const transactions1day = filterTransactions(transactions30days, 1);
    // const transactions3days = filterTransactions(transactions30days, 3);
    // const transactions7days = filterTransactions(transactions30days, 7);
    // const transactions15days = filterTransactions(transactions30days, 15);

    // 处理1天、3天、7天、15天、30天的统计结果，并将结果追加到输出文件
    const addressWithIndex = `${addressIndex}: ${address}\n`;
    fs.appendFileSync(entry.outputFile, addressWithIndex);
    // await processTransactions(address, transactions1day, 1, entry.outputFile);
    // await processTransactions(address, transactions3days, 3, entry.outputFile);
    // await processTransactions(address, transactions7days, 7, entry.outputFile);
    // await processTransactions(address, transactions15days, 15, entry.outputFile);
    await processTransactions(address, transactions30days, 30, entry.outputFile);
    fs.appendFileSync(entry.outputFile, '--------------------------\n');
    addressIndex++;
  }
  console.log('所有地址的交易统计已完成并输出到相应文本文档中');
}

main().catch((error) => {
  console.error("出现错误:", error);
}).finally(() => {
  web3.currentProvider.connection.close();
});
