const Web3 = require('web3');
const ping = require('ping');
const WebsocketProvider = Web3.providers.WebsocketProvider;
const axios = require('axios');
const axiosRetry = require('axios-retry'); // 引入 axios-retry
const fs = require('fs');

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


main().catch((error) => {
  console.error("出现错误:", error);
}).finally(() => {
  web3.currentProvider.connection.close();
});
