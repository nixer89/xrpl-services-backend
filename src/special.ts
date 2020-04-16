import * as Xumm from './xumm';
import * as DB from './db';
import * as config from './util/config'
import * as HttpsProxyAgent from 'https-proxy-agent';
import * as fetch from 'node-fetch';
import {verifySignature} from 'verify-xrpl-signature'
import { XummGetPayloadResponse } from 'xumm-api';
import { TransactionValidation } from './util/types';

export class Special {
    proxy = new HttpsProxyAgent(config.PROXY_URL);
    useProxy = config.USE_PROXY;
    xummBackend = new Xumm.Xumm();
    db = new DB.DB();

    async init() {
        await this.xummBackend.init();
        await this.db.initDb();
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
    
    async getPayloadInfoForFrontendId(origin: string, requestParams:any, payloadType: string, referer?: string): Promise<XummGetPayloadResponse> {
        if(await this.validFrontendUserIdToPayload(origin, requestParams,payloadType, referer)) {
            return this.xummBackend.getPayloadInfoByOrigin(origin, requestParams.payloadId)
        } else {
            return null;
        }
    }
    
    basicPayloadInfoValidation(payloadInfo: XummGetPayloadResponse): boolean {
        return payloadInfo && payloadInfo.meta && payloadInfo.payload && payloadInfo.response
            && payloadInfo.meta.exists && payloadInfo.meta.resolved && payloadInfo.meta.signed;
    }
    
    successfullPaymentPayloadValidation(payloadInfo: XummGetPayloadResponse): boolean {
        if(this.basicPayloadInfoValidation(payloadInfo) && 'payment' === payloadInfo.payload.tx_type.toLowerCase() && payloadInfo.meta.submit && payloadInfo.response.dispatched_result === 'tesSUCCESS') {
            //validate signature
            return verifySignature(payloadInfo.response.hex).signatureValid
        } else {
            return false;
        }
    }
    
    successfullSignInPayloadValidation(payloadInfo: XummGetPayloadResponse): boolean {
        if(this.basicPayloadInfoValidation(payloadInfo) && 'signin' === payloadInfo.payload.tx_type.toLowerCase() && payloadInfo.response.txid && payloadInfo.response.hex && payloadInfo.response.account) {
            //validate signature
            return verifySignature(payloadInfo.response.hex).signatureValid;
        } else {
            return false;
        }
    }

    async checkSignInToValidatePayment(siginPayloadId:string, origin: string, referer: string): Promise<TransactionValidation> {
        console.log("signInToValidate: siginPayloadId: " + siginPayloadId + " origin: " + origin + " referer: " + referer);
        try {
            if(siginPayloadId) {
                let payloadInfo:XummGetPayloadResponse = await this.xummBackend.getPayloadInfoByOrigin(origin, siginPayloadId);

                //console.log("signInPayloadInfo:" + JSON.stringify(payloadInfo));
                if(payloadInfo && this.successfullSignInPayloadValidation(payloadInfo)) {
                    //console.log("sucessfully validated:" + JSON.stringify(payloadInfo));
                    //user signed in successfull -> check his latest payloads
                    let payloadIds:string[] = await this.db.getPayloadIdsByXrplAccountForApplicationAndReferer(referer, await this.db.getAppIdForOrigin(origin), payloadInfo.response.account, "payment");
                    //reverse order to get latest first
                    console.log("payloadIds: " + JSON.stringify(payloadIds));
                    payloadIds = payloadIds.reverse();
                    let validationInfo:any = {success: false};
                    for(let i = 0; i < payloadIds.length; i++) {
                        validationInfo = await this.validateTimedPaymentPayload(origin, referer, await this.xummBackend.getPayloadInfoByOrigin(origin, payloadIds[i]));
                        //console.log("validationInfo: " + JSON.stringify(validationInfo));

                        if(validationInfo.success || validationInfo.payloadExpired)
                            return validationInfo;
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

    async validateTimedPaymentPayload(origin: string, referer:string, payloadInfo: XummGetPayloadResponse): Promise<TransactionValidation> {
        let transactionDate:Date;
        if(this.successfullPaymentPayloadValidation(payloadInfo)) {
            transactionDate = new Date(payloadInfo.response.resolved_at)
            let appId = await this.db.getAppIdForOrigin(origin);
            let originProperties = await this.db.getOriginProperties(appId);

            console.log("checking timeframe");
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
                    return this.validatePaymentOnLedger(payloadInfo.response.txid, payloadInfo);
                } else {
                    return { success: false, payloadExpired : true, testnet: false };
                }
            } else {
                return { success: false, noValidationTimeFrame : true, testnet: false };
            }
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

    async validateXRPLTransaction(txid: string): Promise<TransactionValidation> {
        if(await this.callBithompAndValidate(txid, false)) {
            return {
                success: true,
                testnet: false,
                txid: txid
            };
        } else if (await this.callBithompAndValidate(txid, true)) {
            return {
                success: true,
                testnet: true,
                txid: txid
            };
        } else {
            return {
                success: false,
                testnet: false
            };
        }
    }

    async validatePaymentOnLedger(trxHash:string, payloadInfo: XummGetPayloadResponse): Promise<TransactionValidation> {
        let destinationAccount:any = {
            account: payloadInfo.payload.request_json.Destination,
            tag: payloadInfo.payload.request_json.DestinationTag,
        }
        
        if(trxHash && destinationAccount) {
            if(await this.callBithompAndValidate(trxHash, false, destinationAccount, payloadInfo.payload.request_json.Amount)) {
                return {
                    success: true,
                    testnet: false,
                    txid: trxHash,
                    account: payloadInfo.response.account
                }
            } else if (await this.callBithompAndValidate(trxHash, true, destinationAccount, payloadInfo.payload.request_json.Amount)) {
                return {
                    success: true,
                    testnet: true,
                    txid: trxHash,
                    account: payloadInfo.response.account
                }
            }

            return {
                success: false,
                testnet: false,
                account: payloadInfo.response.account
            }

        } else {
            return {
                success: false,
                testnet: false,
                account: payloadInfo.response.account
            };
        }
    }

    async callBithompAndValidate(trxHash:string, testnet: boolean, destinationAccount?:any, amount?:any): Promise<boolean> {
        try {
            console.log("checking bithomp with trxHash: " + trxHash);
            console.log("checking bithomp with testnet: " + testnet + " - destination account: " + JSON.stringify(destinationAccount) + " - amount: " + JSON.stringify(amount));
            let bithompResponse:any = await fetch.default("https://"+(testnet?'test.':'')+"bithomp.com/api/v2/transaction/"+trxHash, {headers: { "x-bithomp-token": config.BITHOMP_API_TOKEN },agent: this.useProxy ? this.proxy : null});
            if(bithompResponse && bithompResponse.ok) {
                let ledgerTrx:any = await bithompResponse.json();
                console.log("got ledger transaction from " + (testnet? "testnet:": "livenet:") + JSON.stringify(ledgerTrx));

                //standard validation of successfull transaction
                if(ledgerTrx && ledgerTrx.type.toLowerCase() === 'payment'
                    && ledgerTrx.specification && ledgerTrx.specification.destination && (destinationAccount ? ledgerTrx.specification.destination.address === destinationAccount.account : true)
                        && (destinationAccount && destinationAccount.tag ? ledgerTrx.specification.destination.tag == destinationAccount.tag : true) && ledgerTrx.outcome  && ledgerTrx.outcome.result === 'tesSUCCESS') {

                            if(!amount) {
                                //no amount in request. Accept any amount then
                                return true;
                            }
                            //validate delivered amount
                            else if(Number.isInteger(parseInt(amount))) {
                                //handle XRP amount
                                return ledgerTrx.outcome.deliveredAmount.currency === 'XRP' && (parseFloat(ledgerTrx.outcome.deliveredAmount.value)*1000000 == parseInt(amount));
                            } else {
                                //amount not a number so it must be a IOU
                                return ledgerTrx.outcome.deliveredAmount.currency === amount.currency //check currency
                                    && ledgerTrx.outcome.deliveredAmount.issuer === amount.issuer //check issuer
                                        && (Number(ledgerTrx.outcome.deliveredAmount.value) == Number(amount.value)); //check value
                            }

                } else if( ledgerTrx && ledgerTrx.outcome  && ledgerTrx.outcome.result === 'tesSUCCESS') {
                    return true;
                } else {
                    //transaction not valid
                    return false;
                }
            } else {
                return false;
            }
        } catch(err) {
            console.log("ERR validating with bithomp");
            console.log(JSON.stringify(err));
        }
    }
}