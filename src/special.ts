import * as Xumm from './xumm';
import * as DB from './db';
import * as config from './util/config'
import * as fetch from 'node-fetch';
import {verifySignature} from 'verify-xrpl-signature'
import { XummTypes } from 'xumm-sdk';
import { TransactionValidation } from './util/types';
import { FormattedTransactionType, RippleAPI } from 'ripple-lib';
import { v4 as uuidv4 } from 'uuid';

//require('console-stamp')(console, { 
//    format: ':date(yyyy-mm-dd HH:MM:ss) :label' 
//});

export class Special {

    xummBackend = new Xumm.Xumm();
    db = new DB.DB();

    private mainNodes:string[] = ['wss://s1.ripple.com','wss://xrplcluster.com'];
    private testNodes:string[] = ['wss://s.altnet.rippletest.net', 'wss://testnet.xrpl-labs.com'];

    private mainnetApi:RippleAPI = new RippleAPI({server: this.mainNodes[0]});
    private testnetApi:RippleAPI = new RippleAPI({server: this.testNodes[0]});

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
    
    async getPayloadInfoForFrontendId(origin: string, requestParams:any, payloadType: string, request: any, referer?: string): Promise<XummTypes.XummGetPayloadResponse> {
        if(await this.validFrontendUserIdToPayload(origin, requestParams,payloadType, referer)) {
            return this.xummBackend.getPayloadInfoByOrigin(origin, requestParams.payloadId, request)
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

    async checkSignInToValidatePayment(siginPayloadId:string, origin: string, referer: string, request: any): Promise<TransactionValidation> {
        //console.log("signInToValidate: siginPayloadId: " + siginPayloadId + " origin: " + origin + " referer: " + referer);
        try {
            if(siginPayloadId) {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await this.xummBackend.getPayloadInfoByOrigin(origin, siginPayloadId, request);

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
                            validationInfo = await this.validateTimedPaymentPayload(origin, referer, await this.xummBackend.getPayloadInfoByOrigin(origin, payloadIds[i], request), request);
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

    async validateTimedPaymentPayload(origin: string, referer:string, payloadInfo: XummTypes.XummGetPayloadResponse, request: any): Promise<TransactionValidation> {
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
                    return this.validateTransactionOnLedger(payloadInfo, request);
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

    async validateTransactionOnLedger(payloadInfo: XummTypes.XummGetPayloadResponse, request: any): Promise<TransactionValidation> {
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
                    account: payloadInfo.response.account
                }
            } else {
                //do on ledger verification for non trustset transactions!
                let start = Date.now();
                let timeString = (isTestNet ? "Test_" : "Main_") + trxHash;
                console.time(timeString);
                let found = await this.callXrplAndValidate(trxHash, isTestNet, destinationAccount, payloadInfo.payload.request_json.Amount);
                //console.log("Checked " + (isTestNet ? "Testnet:" : "Mainnet:"));
                console.timeEnd(timeString);

                if(request) {
                    let uuid:string = uuidv4();
                    let key:string = 'XRPL_'+uuid;
                    request[key] = "XRPL: " + (Date.now()-start) + " ms";
                }

                if(found) {
                    return {
                        success: true,
                        testnet: isTestNet,
                        txid: trxHash,
                        account: payloadInfo.response.account
                    }
                } else {

                    return {
                        success: false,
                        testnet: isTestNet,
                        account: payloadInfo.response.account
                    }
                }
            }
        } else {
            return {
                success: false,
                testnet: isTestNet,
                account: payloadInfo.response.account
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

    async callXrplAndValidate(trxHash:string, testnet: boolean, destinationAccount?:any, amount?:any): Promise<boolean> {
        try {
            //console.log("checking bithomp with trxHash: " + trxHash);
            //console.log("checking transaction with testnet: " + testnet + " - destination account: " + JSON.stringify(destinationAccount) + " - amount: " + JSON.stringify(amount));
            let apiToUse:RippleAPI = testnet ? this.testnetApi : this.mainnetApi
            try {
                if(!apiToUse.isConnected()) {
                    console.log("wss not connected for " + (testnet ? "testnet" : "mainnet" + ". Connecting..."))
                    await apiToUse.connect();
                }
            } catch(err) {
                console.log("could not connect to: " + (testnet ? this.testNodes[0] : this.mainNodes[0]));
                try {
                    apiToUse = new RippleAPI({server: (testnet ? this.testNodes[1] : this.mainNodes[1])});
                    await apiToUse.connect();

                    if(!apiToUse.isConnected()) {
                        console.log("could not connect 2nd try to: " + (testnet ? this.testNodes[1] : this.mainNodes[1]));
                        return this.callBithompAndValidate(trxHash, testnet, destinationAccount, amount);
                    }
                } catch(err) {
                    console.log("ERROR! could not connect 2nd try to: " + (testnet ? this.testNodes[1] : this.mainNodes[1]));
                    return this.callBithompAndValidate(trxHash, testnet, destinationAccount, amount);
                }
            }

            let transaction:FormattedTransactionType = await apiToUse.getTransaction(trxHash);

            if(transaction) {
                //console.log("got ledger transaction from " + (testnet? "testnet:": "livenet:") + JSON.stringify(transaction));

                //standard validation of successfull transaction
                if(transaction && transaction.type && transaction.type.toLowerCase() === 'payment') {
                    let paymenTransaction:any = transaction.specification;
                    if(paymenTransaction  && (destinationAccount ? paymenTransaction.destination.address === destinationAccount.account : true)
                        && (destinationAccount && destinationAccount.tag ? paymenTransaction.destination.tag == destinationAccount.tag : true) && transaction.outcome  && transaction.outcome.result === 'tesSUCCESS')

                            if(!amount) {
                                //no amount in request. Accept any amount then
                                return true;
                            }
                            //validate delivered amount
                            else if(Number.isInteger(parseInt(amount))) {
                                //handle XRP amount
                                return transaction.outcome.deliveredAmount.currency === 'XRP' && (parseFloat(transaction.outcome.deliveredAmount.value)*1000000 == parseInt(amount));
                            } else {
                                //amount not a number so it must be a IOU
                                return transaction.outcome.deliveredAmount.currency === amount.currency //check currency
                                    && transaction.outcome.deliveredAmount.counterparty === amount.issuer //check issuer
                                        && transaction.outcome.deliveredAmount.value === amount.value; //check value
                            }

                } else if( transaction && transaction.outcome  && transaction.outcome.result === 'tesSUCCESS') {
                    return true;
                } else {
                    //transaction not valid
                    return false;
                }
            } else {
                return false;
            }
        } catch(err) {
            console.log("Transaction not found on " +(testnet ? this.testNodes[0] : this.mainNodes[0]));
            console.log(JSON.stringify(err));
            return false;
        }
    }

    async addEscrow(escrow: any, request: any): Promise<any> {
        //console.log("add escrow: account: " + JSON.stringify(escrow));
        let start = Date.now();

        let escrowListResponse:fetch.Response = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/escrowFinish", {method: "post", body: JSON.stringify(escrow)});

        if(request) {
            let uuid:string = uuidv4();
            let key:string = 'SPECIAL_ESCROW_ADD'+uuid;
            request[key] = "ESCROW_ADD: " + (Date.now()-start) + " ms";
        }

        if(escrowListResponse && escrowListResponse.ok) {
            return escrowListResponse.json();
        } else {
            throw "error calling escrow add api";
        }
    }

    async deleteEscrow(escrow: any, request: any): Promise<any> {
        //console.log("delete escrow: " + JSON.stringify(escrow));
        let start = Date.now();

        let escrowListResponse:fetch.Response = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/escrowFinish/"+escrow.account+"/"+escrow.sequence+"/"+escrow.testnet, {method: "delete"});

        if(request) {
            let uuid:string = uuidv4();
            let key:string = 'SPECIAL_ESCROW_DELETE'+uuid;
            request[key] = "ESCROW_DELETE: " + (Date.now()-start) + " ms";
        }

        if(escrowListResponse && escrowListResponse.ok) {
            return escrowListResponse.json();
        } else {
            //console.log("NOT OKAY")
            throw "error calling escrow delete api";
        }
    }

    async escrowExists(escrow: any, request: any): Promise<any> {
        //console.log("escrowExists: " + JSON.stringify(escrow));
        let start = Date.now();

        let escrowListResponse:fetch.Response = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/escrowFinish/exists/"+escrow.account+"/"+escrow.sequence+"/"+escrow.testnet);

        if(request) {
            let uuid:string = uuidv4();
            let key:string = 'SPECIAL_ESCROW_EXISTS'+uuid;
            request[key] = "ESCROW_EXISTS: " + (Date.now()-start) + " ms";
        }

        if(escrowListResponse && escrowListResponse.ok) {
            return escrowListResponse.json();
        } else {
            //console.log("NOT OKAY")
            throw "error calling escrowExists api";
        }
    }

    async loadEscrowsForAccount(accountInfo: any, request: any) {
        //console.log("loading escrows for account: " + accountInfo.account + " on " + (accountInfo.testnet ? "Testnet" : "Mainnet"));
        let start = Date.now();

        let escrowListResponse:fetch.Response = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/escrows", {method: "post", body: JSON.stringify(accountInfo)});

        if(request) {
            let uuid:string = uuidv4();
            let key:string = 'SPECIAL_ACCOUNT_ESCROWS'+uuid;
            request[key] = "ACCOUNT_ESCROWS: " + (Date.now()-start) + " ms";
        }

        if(escrowListResponse && escrowListResponse.ok) {
            return escrowListResponse.json();
        } else {
            throw "error calling escrow list api";
        }
    }

    async getEscrowNextOrLastRelease(next:boolean, request: any): Promise<any> {
        //console.log("loading getEscrowNextOrLastRelease");
        let escrowCountStats:fetch.Response = null;

        let start = Date.now();

        if(next)
            escrowCountStats = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/stats/nextRelease");
        else
            escrowCountStats = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/stats/lastRelease");

        if(request) {
            let uuid:string = uuidv4();
            let key:string = 'SPECIAL_NEXT_RELEASE'+uuid;
            request[key] = "NEXT_RELEASE: " + (Date.now()-start) + " ms";
        }

        if(escrowCountStats && escrowCountStats.ok) {
            return escrowCountStats.json();
        } else {
            throw "error calling getEscrowNextOrLastRelease";
        }
    }

    async getEscrowCurrentCount(request: any): Promise<any> {
        //console.log("loading getEscrowCurrentCount");
        
        let start = Date.now();
        let escrowCountStats:fetch.Response = await fetch.default(config.TRANSACTION_EXECUTOR_API+"/api/v1/stats/currentCount");

        if(request) {
            let uuid:string = uuidv4();
            let key:string = 'SPECIAL_ESCROW_COUNT'+uuid;
            request[key] = "ESCROW_COUNT: " + (Date.now()-start) + " ms";
        }

        if(escrowCountStats && escrowCountStats.ok) {
            return escrowCountStats.json();
        } else {
            throw "error calling getEscrowCurrentCount";
        }
    }

    async getHottestTrustlines(leastTime: Date, request:any): Promise<any[]> {
        //console.log("loading getHottestTrustlines");
        try {
            let start = Date.now();

            let result:any[] = await  this.db.getHottestToken(leastTime);
            
            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'SPECIAL_HOT_TOKEN'+uuid;
                request[key] = "HOT_TOKEN: " + (Date.now()-start) + " ms";
            }

            return result;
        } catch(err) {
            console.log(err);
        }
    }
}