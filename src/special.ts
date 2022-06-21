import * as Xumm from './xumm';
import * as DB from './db';
import * as config from './util/config'
import * as fetch from 'node-fetch';
import {verifySignature} from 'verify-xrpl-signature'
import { XummTypes } from 'xumm-sdk';
import { TransactionValidation } from './util/types';
import { Client, TxRequest, TxResponse } from 'xrpl'
//import { FormattedTransactionType, RippleAPI } from 'ripple-lib';
require('console-stamp')(console, { 
    format: ':date(yyyy-mm-dd HH:MM:ss) :label' 
});

export class Special {

    xummBackend = new Xumm.Xumm();
    db = new DB.DB();

    private mainNodes:string[] = ['wss://hooks-testnet.xrpl-labs.com', 'wss://hooks-testnet.xrpl-labs.com'];
    private testNodes:string[] = ['wss://hooks-testnet.xrpl-labs.com', 'wss://hooks-testnet.xrpl-labs.com'];

    private currentMainNode:number = 0;
    private currentTestNode:number = 0;

    private mainnetApi:Client = new Client(this.mainNodes[0]);
    private testnetApi:Client = new Client(this.testNodes[0]);

    async init() {
        await this.xummBackend.init();
        await this.db.initDb("special");
        await this.mainnetApi.connect();
        await this.testnetApi.connect();
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
                        testnet: false
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
                    return { success: false, payloadExpired : true, testnet: false, account: payloadInfo.response.account};
                }
            } else {
                return { success: false, noValidationTimeFrame : true, testnet: false, account: payloadInfo.response.account };
            }
        } else {
            return { success: false, testnet: false, error: true, message: "invalid payload or transaction not successfull", account: payloadInfo.response.account}
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
        
        if(trxHash && "tesSUCCESS" === payloadInfo.response.dispatched_result) {

            //do not execute on ledger verification for trustset transactions!
            if(payloadInfo.payload.tx_type === 'TrustSet') {
                return {
                    success: true,
                    testnet: isTestNet,
                    txid: trxHash,
                    account: payloadInfo.response.account,
                    originalPayload: payloadInfo
                }
            } else {
                //do on ledger verification for non trustset transactions!
                let timeString = (isTestNet ? "Test_" : "Main_") + trxHash;
                console.time(timeString);
                let found = await this.callXrplAndValidate(trxHash, isTestNet, destinationAccount, payloadInfo.payload.request_json.Amount);
                //console.log("Checked " + (isTestNet ? "Testnet:" : "Mainnet:"));
                console.timeEnd(timeString);

                if(found) {
                    return {
                        success: true,
                        testnet: isTestNet,
                        txid: trxHash,
                        account: payloadInfo.response.account,
                        originalPayload: payloadInfo
                    }
                } else {

                    //retry another node
                    let timeString = (isTestNet ? "Switch_Test_" : "Main_") + trxHash;
                    console.time(timeString);

                    await this.switchNodes(isTestNet);
                    let found = await this.callXrplAndValidate(trxHash, isTestNet, destinationAccount, payloadInfo.payload.request_json.Amount);

                    console.timeEnd(timeString);

                    if(found) {
                        return {
                            success: true,
                            testnet: isTestNet,
                            txid: trxHash,
                            account: payloadInfo.response.account,
                            originalPayload: payloadInfo
                        }
                    } else {
                        return {
                            success: false,
                            testnet: isTestNet,
                            account: payloadInfo.response.account,
                            originalPayload: payloadInfo
                        }
                    }
                }
            }
        } else {
            return {
                success: false,
                testnet: isTestNet,
                account: payloadInfo.response.account,
                originalPayload: payloadInfo
            };
        }
    }

    async callBithompAndValidate(trxHash:string, testnet: boolean, destinationAccount?:any, amount?:any): Promise<boolean> {
        console.time("BITHOMP_"+trxHash)
        let found:boolean = false;
        try {
            //console.log("checking bithomp with trxHash: " + trxHash);
            //console.log("checking bithomp with testnet: " + testnet + " - destination account: " + JSON.stringify(destinationAccount) + " - amount: " + JSON.stringify(amount));
            let bithompResponse:any = await fetch.default("https://"+(testnet?'test.':'')+"bithomp.com/api/v2/transaction/"+trxHash, {headers: { "x-bithomp-token": config.BITHOMP_API_TOKEN }});
            if(bithompResponse && bithompResponse.ok) {
                let ledgerTrx:any = await bithompResponse.json();
                //console.log("got ledger transaction from " + (testnet? "testnet:": "livenet:") + JSON.stringify(ledgerTrx));

                //standard validation of successfull transaction
                if(ledgerTrx && ledgerTrx.type && ledgerTrx.type.toLowerCase() === 'payment'
                    && ledgerTrx.specification && ledgerTrx.specification.destination && (destinationAccount ? ledgerTrx.specification.destination.address === destinationAccount.account : true)
                        && (destinationAccount && destinationAccount.tag ? ledgerTrx.specification.destination.tag == destinationAccount.tag : true) && ledgerTrx.outcome  && ledgerTrx.outcome.result === 'tesSUCCESS') {

                            if(!amount) {
                                //no amount in request. Accept any amount then
                                found = true;
                            }
                            //validate delivered amount
                            else if(Number.isInteger(parseInt(amount))) {
                                //handle XRP amount
                                found = ledgerTrx.outcome.deliveredAmount.currency === 'XRP' && (parseFloat(ledgerTrx.outcome.deliveredAmount.value)*1000000 == parseInt(amount));
                            } else {
                                //amount not a number so it must be a IOU
                                found = ledgerTrx.outcome.deliveredAmount.currency === amount.currency //check currency
                                    && ledgerTrx.outcome.deliveredAmount.counterparty === amount.issuer //check issuer
                                        && ledgerTrx.outcome.deliveredAmount.value === amount.value; //check value
                            }

                } else if( ledgerTrx && ledgerTrx.outcome  && ledgerTrx.outcome.result === 'tesSUCCESS') {
                    found = true;
                } else {
                    //transaction not valid
                    found = false;
                }
            } else {
                found = false;
            }
        } catch(err) {
            console.log("ERR validating with bithomp");
            console.log(JSON.stringify(err));
        }

        console.log("Checked Bithomp with " + (testnet ? "testnet" : "mainnet"));
        console.timeEnd("BITHOMP_"+trxHash)

        return found;
    }

    async callXrplAndValidate(trxHash:string, testnet: boolean, destinationAccount?:any, amount?:any, retry?: boolean): Promise<boolean> {
        try {
            //console.log("checking bithomp with trxHash: " + trxHash);
            //console.log("checking transaction with testnet: " + testnet + " - destination account: " + JSON.stringify(destinationAccount) + " - amount: " + JSON.stringify(amount));
            let xrplClient:Client = testnet ? this.testnetApi : this.mainnetApi
            try {
                if(!xrplClient.isConnected()) {
                    console.log("wss not connected for " + (testnet ? "testnet" : "mainnet" + ". Connecting..."))
                    await xrplClient.connect();

                    if(xrplClient.isConnected()) {
                        if(testnet)
                            console.log("connecting to " + this.testNodes[this.currentTestNode]);
                        else
                            console.log("connecting to " + this.mainNodes[this.currentMainNode]);
                    } else {
                        console.log("could not connect! switching nodes!")
                        await this.switchNodes(testnet);
                        xrplClient = testnet ? this.testnetApi : this.mainnetApi
                    }
                }
            } catch(err) {
                console.log("could not connect to: " + (testnet ? this.testNodes[this.currentTestNode] : this.mainNodes[this.currentMainNode]));
                try {
                    await this.switchNodes(testnet);

                    xrplClient = new Client((testnet ? this.testNodes[1] : this.mainNodes[1]));
                    await xrplClient.connect();

                    if(!xrplClient.isConnected()) {
                        console.log("could not connect 2nd try to: " + (testnet ? this.testNodes[this.currentTestNode] : this.mainNodes[this.currentMainNode]));
                        console.log("calling bithomp!")
                        return this.callBithompAndValidate(trxHash, testnet, destinationAccount, amount);
                    }
                } catch(err) {
                    console.log("ERROR! could not connect 2nd try to: " + (testnet ? this.testNodes[this.currentTestNode] : this.mainNodes[this.currentMainNode]));
                    console.log("calling bithomp!")
                    return this.callBithompAndValidate(trxHash, testnet, destinationAccount, amount);
                }
            }

            let transactionRequest:TxRequest = {
                command: "tx",
                transaction: trxHash
            }

            let transaction:TxResponse = await xrplClient.request(transactionRequest);

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
                                    return true;
                                }
                                //validate delivered amount
                                else if(!isNaN(amount) && typeof(transactionMetaObject.delivered_amount) === 'string') {
                                    //handle XRP amount
                                    return transactionMetaObject.delivered_amount === amount;

                                } else if(typeof(transactionMetaObject.delivered_amount) === 'object') {
                                    //amount not a number so it must be a IOU
                                    return transactionMetaObject.delivered_amount.currency === amount.currency //check currency
                                        && transactionMetaObject.delivered_amount.issuer === amount.issuer //check issuer
                                            && transactionMetaObject.delivered_amount.value === amount.value; //check value

                                } else {
                                    console.log("something is wrong here!");
                                    console.log(JSON.stringify(transaction))
                                    return false;
                                }
                            } else {
                                console.log("something is wrong here 2!");
                                console.log(JSON.stringify(transaction))
                                return false;
                            }

                    } else {
                        console.log("something is wrong here 3!");
                        console.log(JSON.stringify(transaction))
                        return false;
                    }

                } else if( transaction && transaction.result.meta && typeof(transaction.result.meta) === 'object' && transaction.result.meta.TransactionResult === 'tesSUCCESS') {
                    return true;
                } else {
                    //transaction not valid
                    return false;
                }
            } else {
                return false;
            }
        } catch(err) {
            console.log("Transaction not found on " +(testnet ? this.testNodes[this.currentTestNode] : this.mainNodes[this.currentMainNode]));
            console.log(JSON.stringify(err));
            console.log("switching nodes and trying again")
            await this.switchNodes(testnet);
            if(!retry) {
                console.log("no retry, trying again with new node")
                return this.callXrplAndValidate(trxHash, testnet, destinationAccount, amount, true);
            } else {
                console.log("is retry, could not find connection on either node.")
                return false;
            }
        }
    }

    async switchNodes(testnet:boolean): Promise<void> {        
        if(testnet) {
            if(this.currentTestNode == 0)
                this.currentTestNode = 1;
            else 
                this.currentTestNode = 0;

            await this.testnetApi.disconnect();

            console.log("connecting to " + this.testNodes[this.currentTestNode]);
            this.testnetApi = new Client(this.testNodes[this.currentTestNode]);
            await this.testnetApi.connect();

        } else {
            if(this.currentMainNode == 0)
                this.currentMainNode = 1;
            else 
                this.currentMainNode = 0;

            await this.mainnetApi.disconnect();

            console.log("connecting to " + this.mainNodes[this.currentMainNode]);
            this.mainnetApi = new Client(this.mainNodes[this.currentMainNode]);
            await this.mainnetApi.connect();
        }
    }

    async addEscrow(escrow: any): Promise<any> {
        //console.log("add escrow: account: " + JSON.stringify(escrow));
        
        let escrowListResponse:fetch.Response = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/escrowFinish", {method: "post", body: JSON.stringify(escrow)});

        if(escrowListResponse && escrowListResponse.ok) {
            return escrowListResponse.json();
        } else {
            throw "error calling escrow add api";
        }
    }

    async deleteEscrow(escrow: any): Promise<any> {
        //console.log("delete escrow: " + JSON.stringify(escrow));
        
        let escrowListResponse:fetch.Response = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/escrowFinish/"+escrow.account+"/"+escrow.sequence+"/"+escrow.testnet, {method: "delete"});

        if(escrowListResponse && escrowListResponse.ok) {
            return escrowListResponse.json();
        } else {
            //console.log("NOT OKAY")
            throw "error calling escrow delete api";
        }
    }

    async escrowExists(escrow: any): Promise<any> {
        //console.log("escrowExists: " + JSON.stringify(escrow));
        
        let escrowListResponse:fetch.Response = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/escrowFinish/exists/"+escrow.account+"/"+escrow.sequence+"/"+escrow.testnet);

        if(escrowListResponse && escrowListResponse.ok) {
            return escrowListResponse.json();
        } else {
            //console.log("NOT OKAY")
            throw "error calling escrowExists api";
        }
    }

    async loadEscrowsForAccount(accountInfo: any) {
        //console.log("loading escrows for account: " + accountInfo.account + " on " + (accountInfo.testnet ? "Testnet" : "Mainnet"));
        
        let escrowListResponse:fetch.Response = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/escrows", {method: "post", body: JSON.stringify(accountInfo)});

        if(escrowListResponse && escrowListResponse.ok) {
            return escrowListResponse.json();
        } else {
            throw "error calling escrow list api";
        }
    }

    async getEscrowNextOrLastRelease(next:boolean): Promise<any> {
        //console.log("loading getEscrowNextOrLastRelease");
        let escrowCountStats:fetch.Response = null;

        if(next)
            escrowCountStats = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/stats/nextRelease");
        else
            escrowCountStats = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/stats/lastRelease");

        if(escrowCountStats && escrowCountStats.ok) {
            return escrowCountStats.json();
        } else {
            throw "error calling getEscrowNextOrLastRelease";
        }
    }

    async getEscrowCurrentCount(): Promise<any> {
        //console.log("loading getEscrowCurrentCount");
        
        let escrowCountStats:fetch.Response = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/stats/currentCount");

        if(escrowCountStats && escrowCountStats.ok) {
            return escrowCountStats.json();
        } else {
            throw "error calling getEscrowCurrentCount";
        }
    }

    async getHottestTrustlines(leastTime: Date): Promise<any[]> {
        //console.log("loading getHottestTrustlines");
        try {
            return this.db.getHottestToken(leastTime);
        } catch(err) {
            console.log(err);
        }
    }
}