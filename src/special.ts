import * as Xumm from './xumm';
import * as DB from './db';
import * as config from './util/config'
import * as fetch from 'node-fetch';
import {verifySignature} from 'verify-xrpl-signature'
import { XummTypes } from 'xumm-sdk';
import { TransactionValidation } from './util/types';
import { Client, SubmitResponse, TxRequest, TxResponse } from 'xrpl'
import { XummGetPayloadResponse } from 'xumm-sdk/dist/src/types';
import * as scheduler from 'node-schedule';
//import { FormattedTransactionType, RippleAPI } from 'ripple-lib';
require('console-stamp')(console, { 
    format: ':date(yyyy-mm-dd HH:MM:ss) :label' 
});

interface ClientInfo {
    client: Client,
    lastUsed: number
}

export class Special {

    xummBackend = new Xumm.Xumm();
    db = new DB.DB();

    private fixedNodes:string[];
    private currentNode:number = 0;

    private clientPool:Map<string, ClientInfo> = new Map();

    async init() {
        await this.xummBackend.init();
        await this.db.initDb("special");

        if(!config.ALLOW_CUSTOM_NODES && config.NODES_TO_USE) {
            this.fixedNodes = config.NODES_TO_USE.split(',');

            for(let i = 0; i < this.fixedNodes.length; i++) {
                if(this.fixedNodes[i]?.trim().length > 0) {
                    this.clientPool.set(this.fixedNodes[i], { client: new Client(this.fixedNodes[i]), lastUsed: Date.now()});
                }
            }
        }

        scheduler.scheduleJob("cleanupConnections", {second: 0}, () => this.cleanupConnections());
    }

    resetDBCache() {
        this.db.resetCache();
        this.xummBackend.resetDBCache();
    }

    async validFrontendUserIdToPayload(origin:string, requestParams:any, payloadType: string, referer?: string): Promise<boolean> {
        let frontendUserId:string = requestParams.frontendUserId
        let payloadId:string = requestParams.payloadId;
    
        if(frontendUserId && payloadId)
            return this.validateFrontendIdToPayloadId(await this.db.getAppIdForOrigin(origin), frontendUserId, payloadId,payloadType, referer);
        else
            return false;
    }
    
    async getPayloadInfoForFrontendId(origin: string, requestParams:any, payloadType: string, referer?: string): Promise<XummTypes.XummGetPayloadResponse> {
        if(await this.validFrontendUserIdToPayload(origin, requestParams,payloadType, referer)) {
            return this.xummBackend.getPayloadInfoByOrigin(origin, requestParams.payloadId, "getPayloadInfoForFrontendId")
        } else {
            return null;
        }
    }
    
    basicPayloadInfoValidation(payloadInfo: XummTypes.XummGetPayloadResponse): boolean {
        return payloadInfo && payloadInfo.meta && payloadInfo.payload && payloadInfo.response
            && payloadInfo.meta.exists && payloadInfo.meta.resolved && payloadInfo.meta.signed;
    }
    
    successfullPaymentPayloadValidation(payloadInfo: XummTypes.XummGetPayloadResponse): boolean {
        if(this.basicPayloadInfoValidation(payloadInfo) && 'payment' === payloadInfo.payload.tx_type.toLowerCase() && payloadInfo.meta.submit && payloadInfo.response.dispatched_result === 'tesSUCCESS') {
            //validate signature
            return verifySignature(payloadInfo.response.hex).signatureValid
        } else {
            return false;
        }
    }
    
    successfullSignInPayloadValidation(payloadInfo: XummTypes.XummGetPayloadResponse): boolean {
        if(this.basicPayloadInfoValidation(payloadInfo) && 'signin' === payloadInfo.payload.tx_type.toLowerCase() && payloadInfo.response.txid && payloadInfo.response.hex && payloadInfo.response.account) {
            //validate signature
            return verifySignature(payloadInfo.response.hex).signatureValid;
        } else {
            return false;
        }
    }

    async checkSignInToValidatePayment(siginPayloadId:string, origin: string, referer: string): Promise<TransactionValidation> {
        //console.log("signInToValidate: siginPayloadId: " + siginPayloadId + " origin: " + origin + " referer: " + referer);
        try {
            if(siginPayloadId) {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await this.xummBackend.getPayloadInfoByOrigin(origin, siginPayloadId, "checkSignInToValidatePayment");

                //console.log("signInPayloadInfo:" + JSON.stringify(payloadInfo));
                if(payloadInfo && this.successfullSignInPayloadValidation(payloadInfo)) {
                    //console.log("sucessfully validated:" + JSON.stringify(payloadInfo));
                    //user signed in successfull -> check his latest payloads
                    let payloadIds:string[] = await this.db.getPayloadIdsByXrplAccountForApplicationAndReferer(referer, await this.db.getAppIdForOrigin(origin), payloadInfo.response.account, "payment");
                    //console.log("payloadIds: " + JSON.stringify(payloadIds));
                    if(payloadIds && payloadIds.length > 0) {
                        //reverse order to get latest first
                        payloadIds = payloadIds.reverse();
                        let validationInfo:any = {success: false};
                        for(let i = 0; i < payloadIds.length; i++) {
                            validationInfo = await this.validateTimedPaymentPayload(origin, referer, await this.xummBackend.getPayloadInfoByOrigin(origin, payloadIds[i], "checkSignInToValidatePayment_"));
                            //console.log("validationInfo: " + JSON.stringify(validationInfo));

                            if(validationInfo.success || validationInfo.payloadExpired)
                                return validationInfo;
                        }
                    }
                }
                
                return {
                        success: false,
                        account: payloadInfo.response.account,
                        testnet: false,
                        xummNodeUrl: payloadInfo.response['environment_nodeuri']
                    }
            }

            return { success: false, testnet: false }
        } catch(err) {
            console.log("Error signInToValidate");
            console.log(JSON.stringify(err));
            return { success: false, testnet: false }
        }
    }

    async validateTimedPaymentPayload(origin: string, referer:string, payloadInfo: XummTypes.XummGetPayloadResponse): Promise<TransactionValidation> {
        let transactionDate:Date;
        if(this.successfullPaymentPayloadValidation(payloadInfo)) {
            transactionDate = new Date(payloadInfo.response.resolved_at)
            let appId = await this.db.getAppIdForOrigin(origin);
            let originProperties = await this.db.getOriginProperties(appId);

            if(originProperties && originProperties.payloadValidationTimeframe && JSON.stringify(originProperties.payloadValidationTimeframe).trim().length > 0) {
                //resolve validation time
                let validationTime:number = 0;
                if(originProperties.payloadValidationTimeframe[referer])
                    validationTime = originProperties.payloadValidationTimeframe[referer];
                else if(originProperties.payloadValidationTimeframe[origin+'/*'])
                    validationTime = originProperties.payloadValidationTimeframe[origin+'/*'];
                else if(originProperties.payloadValidationTimeframe['*'])
                    validationTime = originProperties.payloadValidationTimeframe['*'];

                if(validationTime == -1 || (transactionDate && transactionDate.setTime(transactionDate.getTime()+validationTime) > Date.now())) {
                    return this.validateTransactionOnLedger(payloadInfo);
                } else {
                    return { success: false, payloadExpired : true, testnet: false, account: payloadInfo.response.account, xummNodeUrl: payloadInfo.response.dispatched_to};
                }
            } else {
                return { success: false, noValidationTimeFrame : true, testnet: false, account: payloadInfo.response.account, xummNodeUrl: payloadInfo.response.dispatched_to };
            }
        } else {
            return { success: false, testnet: false, error: true, message: "invalid payload or transaction not successfull", account: payloadInfo.response.account, xummNodeUrl: payloadInfo.response.dispatched_to}
        }
    }

    async validateFrontendIdToPayloadId(applicationId: string, frontendUserId: string, payloadId: string, payloadType: string, referer?: string): Promise<boolean> {
        let payloadIdsForFrontendId:string[];
        if(referer)
            payloadIdsForFrontendId = await this.db.getPayloadIdsByFrontendIdForApplicationAndReferer(referer, applicationId, frontendUserId, payloadType);
        else
            payloadIdsForFrontendId = await this.db.getPayloadIdsByFrontendIdForApplication(applicationId, frontendUserId, payloadType);

        //console.log("payloadIdsForFrontendId: " + JSON.stringify(payloadIdsForFrontendId));
        //console.log(payloadIdsForFrontendId.includes(payloadId));
        return payloadIdsForFrontendId.includes(payloadId);
    }

    async validateXummIdToPayloadId(applicationId: string, xummUserId: string, payloadId: string, payloadType: string, referer?: string): Promise<boolean> {
        let payloadIdsForXummUserId:string[]
        if(referer)
            payloadIdsForXummUserId = await this.db.getPayloadIdsByXummIdForApplicationAndReferer(referer, applicationId, xummUserId, payloadType);
        else
            payloadIdsForXummUserId = await this.db.getPayloadIdsByXummIdForApplication(applicationId, xummUserId, payloadType);

        return payloadIdsForXummUserId.includes(payloadId);
    }

    async validateTransactionOnLedger(payloadInfo: XummTypes.XummGetPayloadResponse): Promise<TransactionValidation> {
        //console.log("validatePaymentOnLedger");
        let destinationAccount:any = null;

        if(payloadInfo && payloadInfo.payload && payloadInfo.payload.request_json && payloadInfo.payload.request_json.Destination) {
            destinationAccount = {
                account: payloadInfo.payload.request_json.Destination,
                tag: payloadInfo.payload.request_json.DestinationTag,
            }
        }

        let isTestNet:boolean = "MAINNET" != payloadInfo.response.dispatched_nodetype;
        let trxHash:string = payloadInfo.response.txid;
        let nodeType = payloadInfo.response.dispatched_nodetype;
        let nodeUrl = payloadInfo.response.dispatched_to;
        let customNodeUrl:string = payloadInfo.custom_meta.blob.custom_node && typeof(payloadInfo.custom_meta.blob.custom_node) === 'string' ? payloadInfo.custom_meta.blob.custom_node : null;

        console.log("VALIDATING PAYLOAD:")
        console.log(JSON.stringify(payloadInfo));
        
        if(trxHash && "tesSUCCESS" === payloadInfo.response.dispatched_result) {

            //do not execute on ledger verification for trustset transactions!
            if(payloadInfo.payload.tx_type === 'TrustSet') {
                return {
                    success: true,
                    testnet: isTestNet,
                    txid: trxHash,
                    account: payloadInfo.response.account,
                    originalPayload: payloadInfo,
                    xummNodeUrl: nodeUrl
                    
                }
            } else {
                //do on ledger verification for non trustset transactions!
                let timeString = (isTestNet ? "Test_" : "Main_") + trxHash;
                console.time(timeString);
                let found = await this.callXrplAndValidate(trxHash, destinationAccount, payloadInfo.payload.request_json.Amount, customNodeUrl);
                //console.log("Checked " + (isTestNet ? "Testnet:" : "Mainnet:"));
                console.timeEnd(timeString);
                console.log(timeString +  ": " + found);

                if(found) {
                    return {
                        success: true,
                        testnet: isTestNet,
                        txid: trxHash,
                        account: payloadInfo.response.account,
                        originalPayload: payloadInfo,
                        xummNodeUrl: nodeUrl
                    }
                } else {
                    return {
                        success: false,
                        testnet: isTestNet,
                        account: payloadInfo.response.account,
                        originalPayload: payloadInfo,
                        xummNodeUrl: nodeUrl
                    }
                }
            }
        } else {
            return {
                success: false,
                testnet: isTestNet,
                account: payloadInfo.response.account,
                originalPayload: payloadInfo,
                xummNodeUrl: nodeUrl
            };
        }
    }

    async callXrplAndValidate(trxHash:string, destinationAccount?:any, amount?:any, customNode?:string, retry?: boolean) {

        let found:boolean = false;
        let clientToUse:Client;

        try {
            //console.log("checking bithomp with trxHash: " + trxHash);
            console.log("checking transaction with trxHash: " + trxHash + " - destination account: " + JSON.stringify(destinationAccount) + " - amount: " + JSON.stringify(amount) + " - customNode: " + customNode);

            clientToUse = await this.connectToNode(customNode);
            
            if(!clientToUse) //not connected, cancel here!
                return false;

            let transactionRequest:TxRequest = {
                command: "tx",
                transaction: trxHash
            }

            let transaction:TxResponse = await clientToUse.request(transactionRequest);

            console.log("TRANSACTION RESULT:");
            console.log(JSON.stringify(transaction));

            if(transaction && transaction.result) {
                //console.log("got ledger transaction from " + (testnet? "testnet:": "livenet:") + JSON.stringify(transaction));

                //standard validation of successfull transaction
                if(transaction && transaction.result && transaction.result.TransactionType && transaction.result.TransactionType === "Payment") {

                    if(!destinationAccount || (transaction.result.Destination === destinationAccount.account
                        && (!destinationAccount.tag || transaction.result.DestinationTag == destinationAccount.tag)) && transaction.result.meta && typeof(transaction.result.meta) === 'object' && transaction.result.meta.TransactionResult === 'tesSUCCESS') {

                            const transactionMetaObject = typeof(transaction.result.meta) === 'object' ? transaction.result.meta : null;

                            if(transactionMetaObject) {

                                if(!amount) {
                                    //no amount in request. Accept any amount then
                                    found = true;
                                }
                                //validate delivered amount
                                else if(!isNaN(amount) && typeof(transactionMetaObject.delivered_amount) === 'string') {
                                    //handle XRP amount
                                    found = transactionMetaObject.delivered_amount === amount;

                                } else if(typeof(transactionMetaObject.delivered_amount) === 'object') {
                                    //amount not a number so it must be a IOU
                                    found = transactionMetaObject.delivered_amount.currency === amount.currency //check currency
                                        && transactionMetaObject.delivered_amount.issuer === amount.issuer //check issuer
                                            && transactionMetaObject.delivered_amount.value === amount.value; //check value

                                } else {
                                    console.log("something is wrong here!");
                                    console.log(JSON.stringify(transaction))
                                    found = false;
                                }
                            } else {
                                console.log("something is wrong here 2!");
                                console.log(JSON.stringify(transaction))
                                found = false;
                            }

                    } else {
                        console.log("something is wrong here 3!");
                        console.log(JSON.stringify(transaction))
                        found = false;
                    }

                } else if( transaction && transaction.result.meta && typeof(transaction.result.meta) === 'object' && transaction.result.meta.TransactionResult === 'tesSUCCESS') {
                    found = true;
                } else {
                    //transaction not valid
                    found = false;
                }
            } else {
                found = false;
            }

            //retry if not found!
            if(!found) {
                await this.switchNodes(clientToUse);
                return this.callXrplAndValidate(trxHash, destinationAccount, amount, customNode, true);
            }
        } catch(err) {
            console.log("Transaction not found on " + this.fixedNodes[this.currentNode]);
            console.log(JSON.stringify(err));
            console.log("switching nodes and trying again")
            await this.switchNodes(clientToUse);
            if(!retry) {
                console.log("no retry, trying again with new node")
                found = await this.callXrplAndValidate(trxHash, destinationAccount, amount, customNode, true);
            } else {
                console.log("is retry, could not find connection on either node.")
                found = false;
            }
        }

        return found;
    }

    async submitTransaction(payload:XummGetPayloadResponse, customNode?: string): Promise<SubmitResponse> {
        try {
            let clientToUse = await this.connectToNode(customNode);

            console.log("CONNECTED, SUBMITTING NOW!");

            let signedBlob = payload.response.hex;

            console.log("signedBlob: " + signedBlob);

            return clientToUse.submit(signedBlob);
        } catch(err) {
            console.log("FAILED TO SUBMIT TRANSACTION!!!");
            console.log(err);
        }
    }

    async connectToNode(customNode: string): Promise<Client> {
        let clientToUse:Client;

        try {
            //console.log("checking bithomp with trxHash: " + trxHash);
            //console.log("checking transaction with testnet: " + testnet + " - destination account: " + JSON.stringify(destinationAccount) + " - amount: " + JSON.stringify(amount));

            let nodeToUse:string;

            if(!config.ALLOW_CUSTOM_NODES) {
                nodeToUse = this.fixedNodes[this.currentNode];
                
            } else {
                //connect to custom node!
                if(customNode && customNode.length > 0) {
                    nodeToUse = customNode;
                }
            }

            if(!this.clientPool.has(nodeToUse)) {
                this.clientPool.set(nodeToUse, { client: new Client(nodeToUse), lastUsed: Date.now() });
            }

            clientToUse = this.clientPool.get(nodeToUse).client;            

            try {
                if(!clientToUse.isConnected()) {
                    console.log("wss not connected to " + clientToUse.url + ". Connecting...");
                    await clientToUse.connect();

                    if(clientToUse.isConnected()) {
                        console.log("connected to " + clientToUse.url);
                    } else {
                        console.log("could not connect! switching nodes!")
                        await this.switchNodes(clientToUse);
                        clientToUse = this.clientPool.get(nodeToUse).client; 
                    }
                }
            } catch(err) {
                console.log("could not connect to: " + clientToUse.url);
                try {
                    await this.switchNodes(clientToUse);
                    clientToUse = this.clientPool.get(nodeToUse).client; 

                    if(!clientToUse.isConnected()) {
                        console.log("could not connect 2nd try to: " + clientToUse.url);
                        console.log("Giving up!")
                        clientToUse = null;
                    }
                } catch(err) {
                    console.log("ERROR! could not connect 2nd try to: " + clientToUse.url);
                    console.log("Giving up!")
                    clientToUse = null;
                }
            }
        } catch(err) {
            console.log("Somthing serious happened connecting to the node.")
            clientToUse = null;
        }
        
        //update last used time
        try {
            this.clientPool.get(clientToUse.url).lastUsed = Date.now();
        } catch(err) {
            //log but ignore
            console.log(err);
        }

        return clientToUse;
    }

    async switchNodes(originalClient: Client): Promise<void> {
        console.log("SWITCHING NODES!!!");

        let newUrl = null;

        if(originalClient) {
            //fallback to same node
            newUrl = originalClient.url;
            //disconnect old client
            originalClient.disconnect();
        }

        //only reconnect to different node if we are not a custom node and we have more than 1 fixed nodes available!
        if(!config.ALLOW_CUSTOM_NODES && this.fixedNodes.length > 1) {
            //reconnect to different node
            if(this.currentNode < (this.fixedNodes.length-1))
                this.currentNode++;
            else this.currentNode = 0;

            newUrl = this.fixedNodes[this.currentNode]
        }
        
        console.log("connecting to " + newUrl);
        let newConnection =  new Client(newUrl);
        await newConnection.connect();

        if(newConnection.isConnected()) {
            console.log("connected!")
            this.clientPool.set(newUrl, { client: newConnection, lastUsed: Date.now() });
        } else {
            return null;
        }
    }

    cleanupConnections() {
        if(this.clientPool && this.clientPool.size > 0) {
            this.clientPool.forEach((value, key, map) => {
                if(Date.now() - 300000 - value.lastUsed > 0 ) { //expired!
                    console.log("Expired: " + value.client.url);
                    console.log("Removing it!");
                    this.clientPool.get(key).client.disconnect();
                    this.clientPool.delete(key);
                }
            });
        }
    }
}