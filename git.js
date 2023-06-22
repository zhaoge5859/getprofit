const fs = require('fs');
const axios = require('./api_cache');
const delay = require('delay');
const Web3 = require('web3');
const ping = require('ping');
const path = require('path');

//所有TransferEvents的代币合约均为主流币合约、该哈希为主流币之间的兑换
//买入卖出条件不匹配
//当前Transfer事件有多条匹配结果

//哈希的交易收据为空
//交易收据缺少必要字段，该哈希可能上链报红

//出错  失败  错误  报错  重试

// 需要自定义设置的参数
const DAY_IN_SECONDS = 24 * 60 * 60;
const daysToQuery = 3;

// 设置apikey以及bsc节点===========================================================================================================================>>>设置项<<<
const apiKey = process.env.API_KEYS;
// NodeReal节点
// const nodeHost = 'wss://bsc-mainnet.nodereal.io/ws/v1/f4f337da142043f082f012bcbf34d9f7';
// const nodePing = 'bsc-mainnet.nodereal.io';

// 自建节点
const nodeHost = 'ws://127.0.0.1:8546';
const nodePing = '188.40.62.56';

// 定义节点连接并设置节点重试机制>>>>>>>>>>>>>>>>>>>>>
let retryCount = 0; // 定义重试次数变量
// 节点重试函数
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
// websocket重试机制
const websocketOptions = {
    connectionOptions: {
        reconnect: {
            auto: true,
            delay: 60000, // 尝试每 60 秒重新连接一次
            maxAttempts: 5, // 最多尝试重连 5 次
            onTimeout: true, // 在超时后尝试重连
        },
        clientConfig: {
            maxReceivedFrameSize: 100000000,
            maxReceivedMessageSize: 100000000,
        },
    },
};
// 将自定义的回调函数应用到 websocketOptions 的 reconnect 对象
websocketOptions.connectionOptions.reconnect.shouldReconnect = customReconnect(websocketOptions.connectionOptions.reconnect);
// 定义节点连接并设置重试机制，将修改后的 websocketOptions 传递给 WebsocketProvider
const web3 = new Web3(new Web3.providers.WebsocketProvider(nodeHost, websocketOptions.connectionOptions));

// 获取token交易哈希详细信息
const fetchTransactionDetails = async (hash, transactionIndex = 0, retries = 5) => {
    try {
        const url = 'https://api.bscscan.com/api';
        const params = {
            module: 'proxy',
            action: 'eth_getTransactionByHash',
            txhash: hash,
        };

        const response = await axios.get(url, { params });

        if (response.data.result) {
            return response.data.result;
        } else {
            throw new Error("获取交易详情时出错");
        }
    } catch (error) {
        console.error(`获取交易哈希 ${hash} 的详细信息失败`, error.message);
        if (retries > 0) {
            console.log(`正在重试，剩余重试次数: ${retries}`);
            return await fetchTransactionDetails(hash, transactionIndex, retries - 1);

        }
    }
};

// 获取token交易哈希
const fetchTransactions = async (tokenAddress, tokenIndex, retries = 5, pageIndex = 1) => {
    const offset = 100;
    let totalTransactionCount = 0;
    console.log(`开始查询第 ${tokenIndex} 条token地址: ${tokenAddress}`);

    while (true) {
        try {
            const url = 'https://api.bscscan.com/api';
            const params = {
                module: 'account',
                action: 'tokentx',
                contractaddress: tokenAddress,
                page: pageIndex,
                offset: offset,
                sort: 'asc',
            };

            const response = await axios.get(url, { params });

            if (response.data.status !== '1') {
                console.error(`获取token ${tokenAddress}的交易记录失败`);
                throw new Error(`获取token ${tokenAddress}的交易记录失败，错误信息：${response.data.message}`);
            } else {
                console.log(`获取Token ${tokenAddress} 的第 ${pageIndex} 页交易记录完成，开始获取from地址\n`);

                for (let transactionIndex = 0; transactionIndex < response.data.result.length; transactionIndex++) {
                    const transaction = response.data.result[transactionIndex];
                    const details = await fetchTransactionDetails(transaction.hash, transactionIndex);
                    if (details) {
                        totalTransactionCount++;
                        console.log(`当前Token ${tokenAddress} 的交易记录序号 ${totalTransactionCount}: `, transaction.hash);
                        console.log(`>>>From地址: ${details.from}`);
                        console.log(`>>>To地址: ${details.to}`);

                        try {
                            fs.appendFileSync(path.join(__dirname, 'out_addr.txt'), `${details.from}\n`);
                            console.log(`成功将from地址: ${details.from} 写入到 out_addr.txt 文件中\n`);
                        } catch (err) {
                            console.error(`将from地址: ${details.from} 写入到 out_addr.txt 文件失败，错误信息：${err.message}`);
                        }
                    }
                }
                if (response.data.result.length < offset) {
                    break;
                } else {
                    pageIndex++;
                }
            }
        } catch (error) {
            console.error(`获取token ${tokenAddress}的交易记录失败`, error.message);
            if (retries > 0) {
                console.log(`正在重试，剩余重试次数: ${retries}`);
                return await fetchTransactions(tokenAddress, tokenIndex, retries - 1, pageIndex);

            }
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    console.log(`第 ${tokenIndex} 条token地址: ${tokenAddress} 的查询已完成，总计有 ${totalTransactionCount} 条交易记录\n`);
};

// 删除重复数据
const removeDuplicates = async () => {
    try {
        let data = fs.readFileSync(path.join(__dirname, 'out_addr.txt'), 'utf-8');
        let lines = data.split('\n');

        lines = lines.filter(line => line.trim().length > 0);

        console.log(`所有token地址已查询完毕，out_addr.txt当前共计 ${lines.length} 条地址，开始删除重复数据...\n`);

        let uniqueLines = [...new Set(lines)];
        fs.writeFileSync(path.join(__dirname, 'out_addr.txt'), uniqueLines.join('\n'));

        console.log(`重复数据已删除，out_addr.txt去重后共计 ${uniqueLines.length} 条地址\n`);
    } catch (error) {
        console.error('删除重复数据时出错', error.message);
    }
};

// bscscan-api重试机制函数>>>>>>>>>>>>>>>>>>>>>
async function retryableFetch(url, params, retryTimes = 5) {
    for (let i = 0; i < retryTimes; i++) {
        try {
            const response = await axios.get(url, { params });
            const data = response.data;
            if (data.status === "1") {
                return data;
            }
            console.log(`API请求返回的状态不为 "1"，错误信息: ${data.message}, 响应全文: ${JSON.stringify(data)}, 正在尝试第${i + 1}次重试...`);
        } catch (error) {
            console.log(`API请求失败，正在尝试第${i + 1}次重试...`);
        }
        await delay((i + 1) * 2000);
    }
    throw new Error('API请求失败或返回状态不为 "1"，已超出最大重试次数');
}

// 获取指定时间段内的交易哈希及哈希的详细信息函数>>>>>>>>>>>>>>>>>>>>>
async function getHashRecords(address) {
    const currentTime = Math.floor(new Date().getTime() / 1000);
    const startTime = currentTime - (DAY_IN_SECONDS * daysToQuery);
    const url = `https://api.bscscan.com/api`;
    const params = {
        module: 'account',
        action: 'txlist',
        address: address,
        startblock: 1,
        endblock: 99999999,
        sort: 'asc',
        apiKey: apiKey,
    };
    const data = await retryableFetch(url, params);
    if (data.status !== "1") {
        console.log(`获取地址${address}的哈希记录失败, 错误信息: ${data.message}, 响应全文: ${JSON.stringify(data)}`);
        return [];
    }
    return data.result.filter(tx => tx.timeStamp >= startTime);
}

// 获取交易收据并添加了重试机制的函数>>>>>>>>>>>>>>>>>>>>>
async function retryableGetTransactionReceipt(hash, retryTimes = 5) {
    for (let i = 0; i < retryTimes; i++) {
        try {
            const receipt = await web3.eth.getTransactionReceipt(hash);
            if (!receipt) {
                throw new Error(`哈希的交易收据为空`);
            }
            return receipt;
        } catch (error) {
            console.log(`获取哈希${hash}的交易收据失败，正在尝试第${i + 1}次重试...`, error);
            await delay((i + 1) * 2000);
        }
    }
    console.log(`获取哈希${hash}的交易收据失败，已超出最大重试次数\n`);
    return null;
}

// 获取交易哈希及收据并存入内存变量中的函数>>>>>>>>>>>>>>>>>>>>>
async function getTransactionDataForFiles(files) {

    for (let fileIndex = 1; fileIndex <= files.length; fileIndex++) {
        const file = files[fileIndex - 1];
        console.log(`开始处理文件[${fileIndex}]: ${file}`);
        const addresses = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
        console.log(`文件[${fileIndex}]中包含 ${addresses.length} 个地址`);  // 新增：输出当前文件中地址的数量
        console.log(`当前查询天数${daysToQuery}天`);  // 输出当前查询的时间天数

        for (let addressIndex = 1; addressIndex <= addresses.length; addressIndex++) {
            const address = addresses[addressIndex - 1];
            console.log(`\n\n开始查询文件[${fileIndex}][总数${addresses.length}]中的地址[${addressIndex}]: ${address}\n`);
            let addressData = { // 新的变量，用于保存当前地址的数据
                hashes: [],
                receipts: [],
            };
            const hashRecords = await getHashRecords(address);
            console.log(`\n文件[${fileIndex}]中的地址[${addressIndex}] ${address} [${daysToQuery}天]的交易哈希共计${hashRecords.length}条，获取哈希记录完成，开始获取交易收据\n`);

            for (let hashIndex = 1; hashIndex <= hashRecords.length; hashIndex++) {
                const record = hashRecords[hashIndex - 1];
                const receipt = await retryableGetTransactionReceipt(record.hash);
                if (receipt) {
                    // 检查交易收据是否存在并包含必要的字段
                    if (!receipt.hasOwnProperty('gasUsed') || !receipt.hasOwnProperty('from') || !receipt.hasOwnProperty('to') || !receipt.hasOwnProperty('status') || !receipt.hasOwnProperty('logs')) {
                        console.log(`>>>交易收据缺少必要字段，该哈希可能上链报红(gasUsed|from|to|status|logs)\n`);
                        continue;
                    }
                    // 只有在获取到有效收据之后才添加哈希详情
                    addressData.hashes.push(record);// 添加哈希详情
                    //console.log(`[当前：文件[${fileIndex}]-地址${addressIndex}] ${address}\n>>>哈希记录[${hashIndex}] ${record.hash}\n>>>交易详情: ${JSON.stringify(record, null, 2)}\n`); // 打印哈希记录
                    addressData.receipts.push(receipt); // 添加交易收据
                    //console.log(`>>>当前哈希[${hashIndex}]的交易收据: ${JSON.stringify(receipt, null, 2)}\n\n--------------------------------------------------------------------------------------------------------------------------------------------------------------------------\n\n`); // 打印每个哈希的交易收据
                } else {
                    console.log(`>>>哈希记录[${hashIndex}] ${record.hash}的交易收据获取失败\n`);
                }
            }
            // 为每个地址创建一个单独的文件
            saveDataToFile(addressData, `data/${address}.json`); // 保存当前地址的数据
            console.log(`查询完毕，文件[${fileIndex}]中的地址[${addressIndex}] ${address} [${daysToQuery}天]的交易哈希共计${hashRecords.length}条，获取交易收据完成\n--------------------------------------------------------------------------------------------------------------------------------------------------------------------------\n--------------------------------------------------------------------------------------------------------------------------------------------------------------------------\n`);
        }
        console.log(`文件[${fileIndex}]查询完毕\n`);
    }
}

// 读取并进行初步处理>>>>>>>>>>>>>>>>>>>>>
function analyzeProfit(dataFiles) {
    // 设置接受分析数据的变量
    let analyzedData = {};

    for (let fileIndex = 0; fileIndex < dataFiles.length; fileIndex++) {
        const file = dataFiles[fileIndex];
        console.log("正在读取data目录: " + file);  // 记录当前处理的文件名
        const address = path.basename(file, '.json'); // 以文件名作为地址参数读取
        let addressData = JSON.parse(fs.readFileSync(file, 'utf-8')); // 从文件中读取数据
        analyzedData[address] = addressData.hashes.map((hashData, index) => {
            let receiptData = addressData.receipts[index];
            let gasPrice = BigInt(hashData.gasPrice);
            let gasUsed = BigInt(receiptData.gasUsed);
            let transactionFee = Web3.utils.fromWei((gasPrice * gasUsed).toString(), 'ether');
            let transferEvents = receiptData.logs.filter(log => log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');

            // 重点信息输出数组
            let extraData = {
                hash_from: hashData.from,
                hash_to: hashData.to,
                receipt_from: receiptData.from,
                receipt_to: receiptData.to,
                hash_gasPrice: Web3.utils.fromWei(hashData.gasPrice, 'ether'),
                receipt_gasUsed: receiptData.gasUsed.toString(),
                transactionFee: transactionFee,
                receipt_status: receiptData.status,
                transferEventsCount: transferEvents.length,
            };
            // transfer事件输出
            extraData.transferEvents = transferEvents.map(log => {
                let from = '0x' + log.topics[1].slice(26);
                let to = '0x' + log.topics[2].slice(26);
                let data = log.data === "0x" ? "0x0" : log.data;  // 检查 log.data 是否为 "0x"，如果是则替换为 "0x0"
                let value = BigInt(data);
                let formattedValue = Web3.utils.fromWei(value.toString(), 'ether');
                return {
                    from: from,
                    to: to,
                    value: formattedValue,
                    contract: log.address,
                };
            });
            return {
                address: address,
                hashData: hashData,
                extraData: extraData,
            };
        });
    }
    return analyzedData;
}

// 检查节点同步状态并输出延迟函数>>>>>>>>>>>>>>>>>>>>>
const checkSyncStatusAndLatency = async () => {
    const syncing = await web3.eth.isSyncing();
    console.log('同步状态:', syncing);
    if (syncing) {
        console.log('节点仍在同步，请等待同步完成后再运行脚本。');
        return;
    }
    const pingResponse = await ping.promise.probe(nodePing);
    if (pingResponse.alive) {
        console.log('当前连接节点的延迟:', pingResponse.avg, '毫秒');
    } else {
        console.log('无法测量节点延迟。');
    }
}

// 定义主流币及需排除交易代币的合约地址>>>>>>>>>>>>>>>>>>>>>
const MAINSTREAM_CONTRACT_ADDRESSES = {
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'.toLowerCase(),
    USDT: '0x55d398326f99059fF775485246999027B3197955'.toLowerCase(),
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56'.toLowerCase(),
    BTCB: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c'.toLowerCase(),
    CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'.toLowerCase(),
    USTC: '0x23396cF899Ca06c4472205fC903bDB4de249D6fC'.toLowerCase(),
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'.toLowerCase(),
    DOGE: '0xbA2aE424d960c26247Dd6c32edC70B295c744C43'.toLowerCase(),
    DAIX: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3'.toLowerCase(),
    ETHX: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8'.toLowerCase(),
    XRPX: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE'.toLowerCase(),
    CHIX: '0x0000000000004946c0e9F43F4Dee607b0eF1fA1c'.toLowerCase(),
};

// 定义路由合约>>>>>>>>>>>>>>>>>>>>>
const ROUTER_CONTRACT_ADDRESSES = {
    PANCAKESWAP_V2: '0x10ED43C718714eb63d5aA57B78B54704E256024E'.toLowerCase(),
    MULTICALL_V3: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4'.toLowerCase(),
};

// 将数据保存到文件(覆盖模式)>>>>>>>>>>>>>>>>>>>>>
function saveDataToFile(data, filePath) {
    fs.writeFileSync(filePath, JSON.stringify(data));
}

// 从本地文件中读取数据
function loadDataFromDirectory(address) {
    const filePath = `data/${address}.json`;
    if (fs.existsSync(filePath)) {
        const dataStr = fs.readFileSync(filePath, 'utf-8');
        const addressData = JSON.parse(dataStr);
        return addressData;
    }
    return {};
}

// 主程序main>>>>>>>>>>>>>>>>>>>>>
async function main() {

    // 读取in_tokenAddr.txt中的token地址
    const filePath = 'in_tokenAddr.txt';
    let tokenAddresses = [];

    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        console.error('文件in_tokenAddr.txt不存在或者为空');
    } else {
        tokenAddresses = fs.readFileSync(filePath, 'utf-8').split('\n').filter(line => line.trim().length > 0);

        if (tokenAddresses.length === 0) {
            console.error('文件in_tokenAddr.txt为空');
        }
    }

    if (tokenAddresses.length > 0) {
        console.log(`当前in_tokenAddr.txt文件中一共有 ${tokenAddresses.length} 条token地址\n`);

        // 获取和处理交易记录
        for (let i = 0; i < tokenAddresses.length; i++) {
            const tokenAddress = tokenAddresses[i];
            await fetchTransactions(tokenAddress, i + 1);
        }
    }

    // 删除重复数据
    await removeDuplicates();

    // 输出节点状态及延迟
    await checkSyncStatusAndLatency();

    // 读取当前目录中的文本文件
    const files = [
        './out_addr.txt'
    ];

    // 本地读取优先模式
    console.log('尝试从data目录中读取数据');
    // 检查数据目录是否为空
    if (fs.readdirSync('data').length === 0) {
        // 获取哈希和收据并存入内存变量
        console.log('data目录为空，开始从链上获取数据');
        await getTransactionDataForFiles(files);
        console.log('哈希详情和交易收据原始数据已经保存到data目录中');
    } else {
        console.log('检测到data目录中存在数据，跳过链上获取数据');
    }

    // 读取数据，为下一步分析作准备
    const dataFiles = fs.readdirSync('data').map(filename => `data/${filename}`); // 获取所有本地数据文件的路径
    console.log('\n开始读取数据进行预处理');
    const analyzedData = analyzeProfit(dataFiles);
    //console.log(`开始读取数据进行预处理: ${JSON.stringify(analyzedData, null, 2)}`);
    console.log('数据预处理完成，开始分析盈利');

    // 存储所有地址的分析结果
    let allAnalysisResults = {};

    for (let address in analyzedData) {
        let index = 1;
        for (let data of analyzedData[address]) {
            console.log('\n\n>>>当前分析地址:', data.address);
            console.log('   序号:', index);
            console.log('   交易哈希:', data.hashData.hash);
            console.log('   哈希详细信息:', data.hashData);
            console.log('   哈希From:', data.extraData.hash_from, '哈希To:', data.extraData.hash_to, '手续费:', data.extraData.transactionFee);
            console.log('   收据From:', data.extraData.receipt_from, '收据To:', data.extraData.receipt_to, '手续费:', data.extraData.transactionFee);
            console.log('   哈希交易状态:', data.extraData.receipt_status, '\n');

            // 用于存储分析结果的数组
            let analysisResults = [];
            // 初始化结果变量
            let result = "";

            // 输出当前trnasfer事件的条数
            console.log(`   当前Transfer事件数量: ${data.extraData.transferEventsCount}`);
            // 打印所有的转账事件
            for (let transferEvent of data.extraData.transferEvents) {
                console.log(`   事件From: ${transferEvent.from}  事件To: ${transferEvent.to}  数量: ${transferEvent.value}  代币合约: ${transferEvent.contract}`);
            }

            // 找众数-提取所有转账事件中的代币合约，并排除主流币合约
            let tokenContracts = data.extraData.transferEvents
                .map(event => event.contract.toLowerCase())
                .filter(contract => !Object.values(MAINSTREAM_CONTRACT_ADDRESSES).includes(contract));
            // 计算每个合约出现的频率
            let tokenContractFrequency = {};
            for (let contract of tokenContracts) {
                if (!tokenContractFrequency[contract]) {
                    tokenContractFrequency[contract] = 1;
                } else {
                    tokenContractFrequency[contract]++;
                }
            }
            // 找到出现频率最高的合约
            let mostFrequentTokenContract = [null, 0];
            for (let contract in tokenContractFrequency) {
                if (tokenContractFrequency[contract] > mostFrequentTokenContract[1]) {
                    mostFrequentTokenContract = [contract, tokenContractFrequency[contract]];
                }
            }
            // 保存最频繁的代币合约为数组，以兼容后续代码
            tokenContracts = [mostFrequentTokenContract[0]];

            // 分析所有转账事件
            if (data.extraData.transferEventsCount === 0 || data.extraData.transferEventsCount === 1) {
                result = "该哈希没有TransferEvents或是转账、上链报红、授权、领取空投、充值等操作";
                tokenContracts = tokenContracts || []; // 如果 tokenContracts 是 undefined，将其设置为空数组
                analysisResults.push({ result, tokenContracts });
            } else if (data.extraData.transferEvents.every(event => {
                const matched = Object.values(MAINSTREAM_CONTRACT_ADDRESSES).some(contract => {
                    return contract.toLowerCase() === event.contract.toLowerCase();
                });
                if (!matched) {
                    console.log(`   代币合约与主流币不完全匹配，排除主流币兑换的可能，第一条不匹配的代币合约: ${event.contract}`);
                }
                return matched;
            })) {
                result = "所有TransferEvents的代币合约均为主流币合约、该哈希为主流币之间的兑换";
                tokenContracts = tokenContracts || []; // 如果 tokenContracts 是 undefined，将其设置为空数组
                analysisResults.push({ result, tokenContracts });
            } else {
                let transferEvents = data.extraData.transferEvents;
                let len = transferEvents.length;
                // 对于买入交易，判断前两行
                let buyIndices = [0, 1];
                // 对于卖出交易，判断后两行
                let sellIndices = [len - 1, len - 2];
                // 初始化匹配数量计数器
                let matchedCount = 0;
                // 买入交易判断
                for (let index in transferEvents) {
                    let transferEvent = transferEvents[index];
                    // 读取前两行分析买入交易
                    if (buyIndices.includes(parseInt(index)) && index < len) {
                        if (transferEvent.contract.toLowerCase() === MAINSTREAM_CONTRACT_ADDRESSES.WBNB && (transferEvent.from.toLowerCase() === ROUTER_CONTRACT_ADDRESSES.PANCAKESWAP_V2 || transferEvent.from.toLowerCase() === ROUTER_CONTRACT_ADDRESSES.MULTICALL_V3 || transferEvent.from.toLowerCase() === data.extraData.hash_from.toLowerCase() || transferEvent.from.toLowerCase() === data.extraData.hash_to.toLowerCase())) {
                            result = `BNB买入交易: 买入金额 ${transferEvent.value} BNB, 手续费 ${data.extraData.transactionFee} BNB`;
                            tokenContracts = tokenContracts || []; // 如果 tokenContracts 是 undefined，将其设置为空数组
                            analysisResults.push({
                                result,
                                tokenContracts,
                                bnbBuyCount: 1,
                                bnbBuyAmount: parseFloat(transferEvent.value),
                                bnbBuyfee: parseFloat(data.extraData.transactionFee),
                            });
                            matchedCount++; // 在成功匹配条件后，递增计数器
                        } else if ((transferEvent.contract.toLowerCase() === MAINSTREAM_CONTRACT_ADDRESSES.USDT || transferEvent.contract.toLowerCase() === MAINSTREAM_CONTRACT_ADDRESSES.BUSD || transferEvent.contract.toLowerCase() === MAINSTREAM_CONTRACT_ADDRESSES.USTC) && (transferEvent.from.toLowerCase() === data.extraData.hash_from.toLowerCase() || transferEvent.from.toLowerCase() === data.extraData.hash_to.toLowerCase())) {
                            result = `USDT买入交易: 买入金额 ${transferEvent.value} USDT, 手续费 ${data.extraData.transactionFee} BNB`;
                            tokenContracts = tokenContracts || []; // 如果 tokenContracts 是 undefined，将其设置为空数组
                            analysisResults.push({
                                result,
                                tokenContracts,
                                usdtBuyCount: 1,
                                usdtBuyAmount: parseFloat(transferEvent.value),
                                usdtBuyfee: parseFloat(data.extraData.transactionFee),
                            });
                            matchedCount++; // 在成功匹配条件后，递增计数器
                        }
                    }
                }
                // 卖出交易判断
                for (let index in transferEvents) {
                    let transferEvent = transferEvents[index];
                    // 读取前两行分析买入交易
                    if (sellIndices.includes(parseInt(index)) && index >= 0) {
                        if (transferEvent.contract.toLowerCase() === MAINSTREAM_CONTRACT_ADDRESSES.WBNB && (transferEvent.to.toLowerCase() === ROUTER_CONTRACT_ADDRESSES.PANCAKESWAP_V2 || transferEvent.to.toLowerCase() === ROUTER_CONTRACT_ADDRESSES.MULTICALL_V3 || transferEvent.to.toLowerCase() === data.extraData.hash_from.toLowerCase() || transferEvent.to.toLowerCase() === data.extraData.hash_to.toLowerCase())) {
                            result = `BNB卖出交易: 卖出金额 ${transferEvent.value} BNB, 手续费 ${data.extraData.transactionFee} BNB`;
                            tokenContracts = tokenContracts || []; // 如果 tokenContracts 是 undefined，将其设置为空数组
                            analysisResults.push({
                                result,
                                tokenContracts,
                                bnbSellCount: 1,
                                bnbSellAmount: parseFloat(transferEvent.value),
                                bnbSellFee: parseFloat(data.extraData.transactionFee),
                            });
                            matchedCount++; // 在成功匹配条件后，递增计数器
                        } else if ((transferEvent.contract.toLowerCase() === MAINSTREAM_CONTRACT_ADDRESSES.USDT || transferEvent.contract.toLowerCase() === MAINSTREAM_CONTRACT_ADDRESSES.BUSD || transferEvent.contract.toLowerCase() === MAINSTREAM_CONTRACT_ADDRESSES.USTC) && (transferEvent.to.toLowerCase() === data.extraData.hash_from.toLowerCase() || transferEvent.to.toLowerCase() === data.extraData.hash_to.toLowerCase())) {
                            result = `USDT卖出交易: 卖出金额 ${transferEvent.value} USDT, 手续费 ${data.extraData.transactionFee} BNB`;
                            tokenContracts = tokenContracts || []; // 如果 tokenContracts 是 undefined，将其设置为空数组
                            analysisResults.push({
                                result,
                                tokenContracts,
                                usdtSellCount: 1,
                                usdtSellAmount: parseFloat(transferEvent.value),
                                usdtSellFee: parseFloat(data.extraData.transactionFee),
                            });
                            matchedCount++; // 在成功匹配条件后，递增计数器
                        }
                    }
                }
                if (analysisResults.length === 0) {
                    result = "买入卖出条件不匹配";
                    tokenContracts = tokenContracts || []; // 如果 tokenContracts 是 undefined，将其设置为空数组
                    analysisResults.push({ result, tokenContracts });
                } else {
                    if (matchedCount > 1) {
                        console.log(`   当前Transfer事件有多条匹配结果，匹配买入卖出数量: ${matchedCount}`);
                    } else {
                        console.log(`   当前Transfer事件匹配正常，匹配买入卖出数量: ${matchedCount}`);
                    }
                }
            }
            // 如果当前地址的结果数组还不存在，那么先初始化为空数组
            allAnalysisResults[address] = allAnalysisResults[address] || [];
            // 控制台输出分析结果
            for (let resultObj of analysisResults) {
                let contractsMessage = resultObj.tokenContracts.length > 0 && resultObj.tokenContracts[0] !== null
                    ? resultObj.tokenContracts.map((contract, i) => `   交易代币[${i + 1}]: ${contract}`).join(', ')
                    : "   该哈希没有交易代币";
                console.log('\n   分析结果:', resultObj.result);
                console.log(contractsMessage, '\n');
            }
            index++;  // 在每次循环结束后增加序号
            // 将当前哈希的分析结果添加到当前地址的结果数组中
            allAnalysisResults[address].push(...analysisResults);
        }
        console.log('\n\n>>>当前分析地址:', address, '分析完毕，开始分析下一个地址\n----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------\n----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------\n');
    }

    // 在以上分析结束后输出总的买入卖出分析结果以便进行下一步盈利计算//=================================================================================================>>>设置项<<<
    for (let address in allAnalysisResults) {
        let index = 1;  // 初始化序号
        let BNBSwapUSDT = 300;
        let profit_Expect = 200; // 3天利润最低
        let frequency_Expect_low = 0; // 总买入卖出最低次数
        let frequency_Expect_high = 1000; // 总买入卖出最高次数
        let bnbBuyCount_Expect = 0; // bnb买入最低次数
        let Winrate_Expect = 200; // 利润率排除

        let totalBnbBuyCount = 0;
        let totalBnbBuyAmount = 0;
        let totalBnbBuyfee = 0;
        let totalBnbSellCount = 0;
        let totalBnbSellAmount = 0;
        let totalBnbSellFee = 0;

        let totalUsdtBuyCount = 0;
        let totalUsdtBuyAmount = 0;
        let totalUsdtBuyfee = 0;
        let totalUsdtSellCount = 0;
        let totalUsdtSellAmount = 0;
        let totalUsdtSellFee = 0;

        console.log('\n\n>>>当前地址', address, '根据分析结果按交易代币进行归类的买入卖出交易明细如下：\n');

        // 过滤没有交易代币的输出结果
        let filteredResults = allAnalysisResults[address].filter(resultObj =>
            resultObj.tokenContracts.length > 0 && resultObj.tokenContracts[0] !== null
        );

        // // 输出过滤后的分析结果(未排序版本 - 留着出问题时检查用)
        // for (let resultObj of filteredResults) {
        //     console.log('   序号:', index);
        //     index++;
        //     // 输出买入卖出的结果以及代币合约
        //     if (resultObj.bnbBuyCount > 0) {
        //         console.log('>>>BNB买入', resultObj.bnbBuyCount, '次', '买入金额', resultObj.bnbBuyAmount, 'BNB', '手续费', resultObj.bnbBuyfee, '交易代币', resultObj.tokenContracts.join(', '));
        //     }
        //     if (resultObj.bnbSellCount > 0) {
        //         console.log('>>>BNB卖出', resultObj.bnbSellCount, '次', '卖出金额', resultObj.bnbSellAmount, 'BNB', '手续费', resultObj.bnbSellFee, '交易代币', resultObj.tokenContracts.join(', '));
        //     }
        //     if (resultObj.usdtBuyCount > 0) {
        //         console.log('>>>USDT买入', resultObj.usdtBuyCount, '次', '买入金额', resultObj.usdtBuyAmount, 'USDT', '手续费', resultObj.usdtBuyfee, '交易代币', resultObj.tokenContracts.join(', '));
        //     }
        //     if (resultObj.usdtSellCount > 0) {
        //         console.log('>>>USDT卖出', resultObj.usdtSellCount, '次', '卖出金额', resultObj.usdtSellAmount, 'USDT', '手续费', resultObj.usdtSellFee, '交易代币', resultObj.tokenContracts.join(', '));
        //     }
        //     console.log('\n-----------------------------------------------------------------------------------------')
        // }
        // console.log('\n\n\n\n\n\n\n\n\n')

        // 按交易代币排序交易记录（排序版本）
        let sortedResults = {};

        // 用于存储每种代币的买入和卖出金额以计算盈利比
        let tokenBuyAmounts = {};
        let tokenSellAmounts = {};
        let tokenBuyFees = {};
        let tokenSellFees = {};

        for (let resultObj of filteredResults) {
            let bnbBuyCount = resultObj.bnbBuyCount || 0;
            let bnbBuyAmount = resultObj.bnbBuyAmount || 0;
            let bnbBuyfee = resultObj.bnbBuyfee || 0;
            let bnbSellCount = resultObj.bnbSellCount || 0;
            let bnbSellAmount = resultObj.bnbSellAmount || 0;
            let bnbSellFee = resultObj.bnbSellFee || 0;

            totalBnbBuyCount += bnbBuyCount;
            totalBnbBuyAmount += bnbBuyAmount;
            totalBnbBuyfee += bnbBuyfee;
            totalBnbSellCount += bnbSellCount;
            totalBnbSellAmount += bnbSellAmount;
            totalBnbSellFee += bnbSellFee;

            let usdtBuyCount = resultObj.usdtBuyCount || 0;
            let usdtBuyAmount = resultObj.usdtBuyAmount || 0;
            let usdtBuyfee = resultObj.usdtBuyfee || 0;
            let usdtSellCount = resultObj.usdtSellCount || 0;
            let usdtSellAmount = resultObj.usdtSellAmount || 0;
            let usdtSellFee = resultObj.usdtSellFee || 0;

            totalUsdtBuyCount += usdtBuyCount;
            totalUsdtBuyAmount += usdtBuyAmount;
            totalUsdtBuyfee += usdtBuyfee;
            totalUsdtSellCount += usdtSellCount;
            totalUsdtSellAmount += usdtSellAmount;
            totalUsdtSellFee += usdtSellFee;

            for (let contract of resultObj.tokenContracts) {
                if (!sortedResults[contract]) {
                    sortedResults[contract] = [];
                    // 在这里检查和初始化每种代币的买入和卖出金额
                    if (!tokenBuyAmounts[contract]) {
                        tokenBuyAmounts[contract] = { bnb: 0, usdt: 0 };
                    }
                    if (!tokenSellAmounts[contract]) {
                        tokenSellAmounts[contract] = { bnb: 0, usdt: 0 };
                    }
                    // 这里应该检查 tokenBuyFees[contract] 和 tokenSellFees[contract]
                    if (!tokenBuyFees[contract]) {
                        tokenBuyFees[contract] = { bnb: 0, usdt: 0 };
                    }
                    if (!tokenSellFees[contract]) {
                        tokenSellFees[contract] = { bnb: 0, usdt: 0 };
                    }
                }
                sortedResults[contract].push(resultObj);
                // 累加每种代币的买入和卖出金额及手续费
                tokenBuyAmounts[contract].bnb += bnbBuyAmount;
                tokenBuyAmounts[contract].usdt += usdtBuyAmount;
                tokenSellAmounts[contract].bnb += bnbSellAmount;
                tokenSellAmounts[contract].usdt += usdtSellAmount;
                tokenBuyFees[contract].bnb += bnbBuyfee;
                tokenBuyFees[contract].usdt += usdtBuyfee;
                tokenSellFees[contract].bnb += bnbSellFee;
                tokenSellFees[contract].usdt += usdtSellFee;
            }
        }

        let bnbProfit = totalBnbSellAmount - totalBnbBuyAmount - totalBnbSellFee - totalBnbBuyfee;
        let usdtProfit = totalUsdtSellAmount - totalUsdtBuyAmount - totalUsdtSellFee - totalUsdtBuyfee;
        let totalProfit = bnbProfit * BNBSwapUSDT + usdtProfit;
        let totalAllCount = totalBnbBuyCount + totalBnbSellCount + totalUsdtBuyCount + totalUsdtSellCount;

        let winCount = 0; // 盈利次数
        let lossCount = 0; // 亏损次数
        // 按交易代币输出每一类交易（排序版本）
        for (let contract in sortedResults) {
            console.log(`>>>交易代币 ${contract} 的买入卖出交易明细如下：`);

            for (let resultObj of sortedResults[contract]) {
                // 输出买入卖出的结果以及代币合约
                if (resultObj.bnbBuyCount > 0) {
                    console.log('>>>BNB买入', resultObj.bnbBuyCount, '次', '||', '买入金额', '||', resultObj.bnbBuyAmount, '||', 'BNB', '手续费', '||', resultObj.bnbBuyfee, '||', 'BNB');
                }
                if (resultObj.bnbSellCount > 0) {
                    console.log('>>>BNB卖出', resultObj.bnbSellCount, '次', '||', '卖出金额', '||', resultObj.bnbSellAmount, '||', 'BNB', '手续费', '||', resultObj.bnbSellFee, '||', 'BNB');
                }
                if (resultObj.usdtBuyCount > 0) {
                    console.log('>>>USDT买入', resultObj.usdtBuyCount, '次', '||', '买入金额', '||', resultObj.usdtBuyAmount, '||', 'USDT', '手续费', '||', resultObj.usdtBuyfee, '||', 'BNB');
                }
                if (resultObj.usdtSellCount > 0) {
                    console.log('>>>USDT卖出', resultObj.usdtSellCount, '次', '||', '卖出金额', '||', resultObj.usdtSellAmount, '||', 'USDT', '手续费', '||', resultObj.usdtSellFee, '||', 'BNB');
                }
            }

            // 计算每种代币的盈亏，包含手续费
            let bnbProfit = tokenSellAmounts[contract].bnb - tokenBuyAmounts[contract].bnb - tokenSellFees[contract].bnb - tokenBuyFees[contract].bnb;
            let usdtProfit = tokenSellAmounts[contract].usdt - tokenBuyAmounts[contract].usdt - tokenSellFees[contract].usdt - tokenBuyFees[contract].usdt;
            let totalProfit = bnbProfit * BNBSwapUSDT + usdtProfit;

            // 判断总盈利是否大于0，然后输出结果
            if (totalProfit > 0) {
                console.log(`\n   BNB盈利`, bnbProfit, 'BNB', '||', `USDT盈利`, usdtProfit, 'USDT', '||', `买卖当前代币总盈利`, '||', totalProfit, '||', 'USDT', '「赚」');
                winCount++;
            } else {
                console.log(`\n   BNB盈利`, bnbProfit, 'BNB', '||', `USDT盈利`, usdtProfit, 'USDT', '||', `买卖当前代币总盈利`, '||', totalProfit, '||', 'USDT', '「亏」');
                lossCount++;
            }
            console.log('-----------------------------------------------------------------------------------------')
        }

        // 计算并输出胜率及总计查询结果
        let totalOperations = winCount + lossCount;
        let winRate = totalOperations > 0 ? (winCount / totalOperations * 100).toFixed(2) : 0;
        console.log(`\n>>>当前地址 ${address} ${daysToQuery} 天总买卖次数${totalAllCount}次 总盈利统计结果:\n`);
        console.log('   买入次数:', totalBnbBuyCount, '次', '买入金额:', totalBnbBuyAmount, 'BNB', '买入手续费:', totalBnbBuyfee, 'BNB', '\n', '  卖出次数:', totalBnbSellCount, '次', '卖出金额:', totalBnbSellAmount, 'BNB', '卖出手续费:', totalBnbSellFee, 'BNB', '\n', '  BNB总盈利金额:', bnbProfit, 'BNB', '\n\n', '  买入次数:', totalUsdtBuyCount, '次', '买入金额:', totalUsdtBuyAmount, 'USDT', '买入手续费:', totalUsdtBuyfee, 'USDT', '\n', '  卖出次数:', totalUsdtSellCount, '次', '卖出金额:', totalUsdtSellAmount, 'USDT', '卖出手续费:', totalUsdtSellFee, 'USDT', '\n', '  USDT盈利金额:', usdtProfit, 'USDT', '\n\n', '  总盈利金额:', totalProfit, 'USDT', '盈利', winCount, '次', '亏损', lossCount, '次', '胜率', winRate, '%');

        // 输出符合条件的地址统计结果并写入文件
        if (totalProfit > profit_Expect && totalAllCount > frequency_Expect_low && totalAllCount < frequency_Expect_high && totalBnbBuyCount > bnbBuyCount_Expect && winRate < Winrate_Expect) {
            const content = `
            >>>当前地址 ${address} ${daysToQuery} 天总买卖次数${totalAllCount}次 总盈利统计结果:
               买入次数:${totalBnbBuyCount}次 买入金额:${totalBnbBuyAmount}BNB 买入手续费:${totalBnbBuyfee}BNB
               卖出次数:${totalBnbSellCount}次 卖出金额:${totalBnbSellAmount}BNB 卖出手续费:${totalBnbSellFee}BNB
               BNB总盈利金额:${bnbProfit}BNB
        
               买入次数:${totalUsdtBuyCount}次 买入金额:${totalUsdtBuyAmount}USDT 买入手续费:${totalUsdtBuyfee}USDT
               卖出次数:${totalUsdtSellCount}次 卖出金额:${totalUsdtSellAmount}USDT 卖出手续费:${totalUsdtSellFee}USDT
               USDT盈利金额:${usdtProfit}USDT
        
               总盈利金额:${totalProfit}USDT 盈利${winCount}次 亏损${lossCount}次 胜率${winRate}%
        
            -----------------------------------------------------------------------------------------\n`;

            try {
                fs.appendFileSync('./out_finalProfit.txt', content);
                console.log(`\n   符合筛选条件，地址 ${address} 的统计结果已成功写入out_finalProfit.txt文件！`);
            } catch (error) {
                console.error(`\n   写入文件失败，错误信息为：${error}`);
            }
        } else {
            console.log(`\n   地址 ${address} 不符合筛选条件，跳过写入out_finalProfit.txt文件`)
            console.log('\n----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------\n----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------\n');
        }
    }
    await delay(1000);
}

main().catch((error) => {
    console.error("出现错误:", error);
    web3.currentProvider.connection.close();
}).finally(() => {
    console.log(`\n\n   运行完毕，关闭节点连接\n`)
    web3.currentProvider.connection.close();
});
