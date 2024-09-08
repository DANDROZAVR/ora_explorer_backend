import { HypersyncClient, Decoder, LogField, TransactionField, CallDecoder, presetQueryLogsOfEvent } from '@envio-dev/hypersync-client';
import { Interface } from '@ethersproject/abi';
import { global_pool} from "./pool.js";
import {Web3} from "web3";

const web3 = new Web3(new Web3.providers.HttpProvider('https://rpc.ankr.com/eth'));


const ORA_RESPONSES_ADDRESS = "0x0a0f4321214bb6c7811dd8a71cf587bdaf03f0a0";
const ORA_REQUESTS_ADDRESS = "0x61423153f111BCFB28dd264aBA8d9b5C452228D2";
const CHAIN_ID = 0; // Ethereum Mainnet

const convertBytesToText = (bytes) => {
    if (bytes.startsWith('0x')) bytes = bytes.slice(2);
    const buffer = Buffer.from(bytes, 'hex');
    return buffer.toString('utf-8');
}

const decodeOmaLogs = (rawLogInput) => {
    const abi = [
        "event AICallbackResult(address indexed address,uint256 indexed requestID, address invoker, bytes output)",
        "event promptRequest (uint256 requestId, address sender, uint256 modelId, string prompt)"
    ];
    const iface = new Interface(abi);
    let topicsWithoutNulls = rawLogInput.topics;
    while (topicsWithoutNulls.length > 0 && topicsWithoutNulls[topicsWithoutNulls.length - 1] == null) {
        topicsWithoutNulls = topicsWithoutNulls.slice(0, -1);
    }
    const decoded = iface.parseLog({ data: rawLogInput.data, topics: topicsWithoutNulls });

    let results = [];
    for (let idx = 0; idx < rawLogInput.topics.length; idx++) {
        let copyArg = decoded.args[idx];
        if (decoded.name === "AICallbackResult" && idx === 3) {
            copyArg = convertBytesToText(copyArg);
        }
        results.push(copyArg);
    }
    return [decoded.name, ...results];
}

async function getBlockTimestamp(blockNumber) {
  try {
    // Get block details
    const block = await web3.eth.getBlock(blockNumber);
    return block.timestamp; // Returns timestamp in seconds
  } catch (error) {
    console.error('Error fetching block:', error);
  }
}

const insertTransaction = async (tableName, txData) => {
    const timestamp = Number(await getBlockTimestamp(txData.block_number))
    const client = await global_pool.connect();
    try {
        await client.query('BEGIN');
        const queryText = `
            INSERT INTO ${tableName} (tx_id, req_id, chain_id, user_address, text, block_number, timestamp)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (tx_id) DO NOTHING;
        `;
        const values = [txData.tx_id, txData.req_id, txData.chain_id, txData.user_address, txData.text, txData.block_number, timestamp];
        await client.query(queryText, values);
        await client.query('COMMIT');
        console.log(`inserted to ${tableName}`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error inserting into ${tableName}:`, error);
    } finally {
        client.release();
    }
}

const processTransactions = async (query) => {
    const client = HypersyncClient.new({ url: "https://eth.hypersync.xyz" });

    while (true) {
        const res = await client.get(query);
        if (res.data.logs.length !== 0) {
            for (const txn of res.data.logs) {
                const decodedInput = decodeOmaLogs(txn);
                const blockNumber = txn.blockNumber;

                // Determine the type of the log here
                if (decodedInput[0] === 'promptRequest') {
                    const txData = {
                        tx_id: txn.transactionHash,
                        req_id: Number(decodedInput[1]),
                        chain_id: CHAIN_ID,
                        user_address: decodedInput[2],
                        text: decodedInput[4],
                        block_number: blockNumber
                    };
                    await insertTransaction('prompt_requests', txData);
                } else if (decodedInput[0] === 'AICallbackResult') {
                    const txData = {
                        tx_id: txn.transactionHash,
                        chain_id: CHAIN_ID,
                        req_id: Number(decodedInput[2]),
                        user_address: decodedInput[1],
                        text: decodedInput[4],
                        block_number: blockNumber,
                    };
                    await insertTransaction('prompt_answers', txData);
                }
            }
        } else {
            console.log('No transactions found');
        }

        let height = res.archiveHeight;
        while (height < res.nextBlock) {
            console.log(`Waiting for chain to advance. Height is ${height}`);
            height = await client.getHeight();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        query.fromBlock = res.nextBlock;
    }
}

const main = async () => {
    let lastProcessedTxBlock = 20614965; // To be fetched from DB
    const query_requests = presetQueryLogsOfEvent(ORA_REQUESTS_ADDRESS, '0xa0faead83d70148ae18b694377f9bef079251342ab90e14af0f9ef68b891269f', lastProcessedTxBlock, 100000000000);
    const query_responses = presetQueryLogsOfEvent(ORA_RESPONSES_ADDRESS, '0xb7b413554c4e94c80cfbb175a0e4727f2f425d29b980195c49dac293c2914fc0', lastProcessedTxBlock, 100000000000);
    processTransactions(query_requests);
    processTransactions(query_responses);
}

main();
