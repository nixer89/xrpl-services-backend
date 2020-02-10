import * as Xumm from './xumm';
import * as DB from './db';
import * as config from './config'
import * as HttpsProxyAgent from 'https-proxy-agent';
import * as fetch from 'node-fetch';
import {verifySignature} from 'verify-xrpl-signature'

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
    }

    async validFrontendUserIdToPayload(origin:string, requestParams:any, payloadType: string, referer?: string): Promise<boolean> {
        let frontendUserId:string = requestParams.frontendUserId
        let payloadId:string = requestParams.payloadId;
    
        if(frontendUserId && payloadId)
            return this.validateFrontendIdToPayloadId(origin, await this.db.getAppIdForOrigin(origin), frontendUserId, payloadId,payloadType, referer);
        else
            return false;
    }
    
    async getPayloadInfoForFrontendId(origin: string, requestParams:any, payloadType: string, referer?: string): Promise<any> {
        if(await this.validFrontendUserIdToPayload(origin, requestParams,payloadType, referer)) {
            return this.xummBackend.getPayloadInfoByOrigin(origin, requestParams.payloadId)
        } else {
            return null;
        }
    }
    
    basicPayloadInfoValidation(payloadInfo: any): boolean {
        return payloadInfo && !payloadInfo.error && payloadInfo.meta && payloadInfo.payload && payloadInfo.response
            && payloadInfo.meta.exists && payloadInfo.meta.resolved && payloadInfo.meta.signed;
    }
    
    successfullPaymentPayloadValidation(payloadInfo: any): boolean {
        if(this.basicPayloadInfoValidation(payloadInfo) && 'payment' === payloadInfo.payload.tx_type.toLowerCase() && payloadInfo.meta.submit && payloadInfo.response.dispatched_result === 'tesSUCCESS') {
            //validate signature
            let signatureValidation = verifySignature(payloadInfo.response.hex)

            return signatureValidation.signatureValid && signatureValidation.signedBy === payloadInfo.response.account;
        } else {
            return false;
        }
    }
    
    successfullSignInPayloadValidation(payloadInfo: any): boolean {
        if(this.basicPayloadInfoValidation(payloadInfo) && 'signin' === payloadInfo.payload.tx_type.toLowerCase() && payloadInfo.response.txid && payloadInfo.response.hex && payloadInfo.response.account) {
            //validate signature
            let signatureValidation = verifySignature(payloadInfo.response.hex)

            return signatureValidation.signatureValid && signatureValidation.signedBy === payloadInfo.response.account;
        } else {
            return false;
        }
    }

    async checkSignInToValidatePayment(siginPayloadId:string, origin: string, referer: string) {
        console.log("signInToValidate: siginPayloadId: " + siginPayloadId + " origin: " + origin + " referer: " + referer);
        try {
            if(siginPayloadId) {
                let payloadInfo:any = await this.xummBackend.getPayloadInfoByOrigin(origin, siginPayloadId);

                //console.log("signInPayloadInfo:" + JSON.stringify(payloadInfo));
                if(payloadInfo && this.successfullSignInPayloadValidation(payloadInfo)) {
                    //console.log("sucessfully validated:" + JSON.stringify(payloadInfo));
                    //user signed in successfull -> check his latest payloads
                    let payloadIds:string[] = await this.db.getPayloadIdsByXrplAccountForOriginAndReferer(origin, referer, await this.db.getAppIdForOrigin(origin), payloadInfo.response.account, "payment");
                    //reverse order to get latest first
                    //console.log("payloadIds: " + JSON.stringify(payloadIds));
                    payloadIds = payloadIds.reverse();
                    let validationInfo:any = {success: false};
                    for(let i = 0; i < payloadIds.length; i++) {
                        validationInfo = await this.validateTimedPaymentPayload(origin, await this.xummBackend.getPayloadInfoByOrigin(origin, payloadIds[i]));
                        //console.log("validationInfo: " + JSON.stringify(validationInfo));

                        if(validationInfo.success || validationInfo.payloadExpired)
                            return validationInfo;
                    }
                }
                return { success: false}
            }

            return { success: false }
        } catch(err) {
            console.log("Error signInToValidate");
            console.log(JSON.stringify(err));
            return { success: false }
        }
    }

    async validateTimedPaymentPayload(origin: string, payloadInfo: any): Promise<any> {
        let transactionDate:Date;
        if(this.successfullPaymentPayloadValidation(payloadInfo)) {
            transactionDate = new Date(payloadInfo.response.resolved_at)
            let originProperties = await this.db.getOriginProperties(origin);

            if(originProperties && originProperties.payloadValidationTimeframe) {
                if(transactionDate && transactionDate.setTime(transactionDate.getTime()+originProperties.payloadValidationTimeframe) > Date.now()) {
                    return this.validatePaymentOnLedger(payloadInfo.response.txid, origin, payloadInfo);
                } else {
                    return { success: false, payloadExpired : true };
                }
            } else {
                return { success: false, noValidationTimeFrame : true };
            }
        }
    }

    async validateFrontendIdToPayloadId(origin: string, applicationId: string, frontendUserId: string, payloadId: string, payloadType: string, referer?: string): Promise<boolean> {
        let payloadIdsForFrontendId:string[];
        if(referer)
            payloadIdsForFrontendId = await this.db.getPayloadIdsByFrontendIdForOriginAndReferer(origin, referer, applicationId, frontendUserId, payloadType);
        else
            payloadIdsForFrontendId = await this.db.getPayloadIdsByFrontendIdForOrigin(origin, applicationId, frontendUserId, payloadType);

        //console.log("payloadIdsForFrontendId: " + JSON.stringify(payloadIdsForFrontendId));
        //console.log(payloadIdsForFrontendId.includes(payloadId));
        return payloadIdsForFrontendId.includes(payloadId);
    }

    async validateXummIdToPayloadId(origin: string, applicationId: string, xummUserId: string, payloadId: string, payloadType: string, referer?: string): Promise<boolean> {
        let payloadIdsForXummUserId:string[]
        if(referer)
            payloadIdsForXummUserId = await this.db.getPayloadIdsByXummIdForOriginAndReferer(origin, referer, applicationId, xummUserId, payloadType);
        else
            payloadIdsForXummUserId = await this.db.getPayloadIdsByXummIdForOrigin(origin, applicationId, xummUserId, payloadType);

        return payloadIdsForXummUserId.includes(payloadId);
    }

    async validatePaymentOnLedger(trxHash:string, origin:string, payloadInfo: any): Promise<any> {
        let destinationAccount = await this.db.getAllowedOriginDestinationAccount(origin);
        console.log("validate Payment with dest account: " + destinationAccount + " and hash: " + trxHash)
        if(trxHash && destinationAccount) {
            if(await this.callBithompAndValidate(trxHash, destinationAccount, payloadInfo.payload.request_json.Amount, false)) {
                return {
                    success: true,
                    testnet: false
                }
            } else if (await this.callBithompAndValidate(trxHash, destinationAccount, payloadInfo.payload.request_json.Amount, true)) {
                return {
                    success: true,
                    testnet: true
                }
            }

            return {
                success: false,
                testnet: false
            }

        } else {
            return {
                success: false,
                testnet: false
            };
        }
    }

    async callBithompAndValidate(trxHash:string, destinationAccount:string, amount:any, testnet: boolean): Promise<boolean> {
        try {
            let bithompResponse:any = await fetch.default("https://"+(testnet?'test.':'')+"bithomp.com/api/v2/transaction/"+trxHash, {headers: { "x-bithomp-token": config.BITHOMP_API_TOKEN },agent: this.useProxy ? this.proxy : null});
            if(bithompResponse && bithompResponse.ok) {
                let ledgerTrx:any = await bithompResponse.json();
                //console.log("got ledger transaction from " + (testnet? "testnet:": "livenet:") + JSON.stringify(ledgerTrx));

                //standard validation of successfull transaction
                if(ledgerTrx && ledgerTrx.type.toLowerCase() === 'payment'
                    && ledgerTrx.specification && ledgerTrx.specification.destination && ledgerTrx.specification.destination.address === destinationAccount
                        && ledgerTrx.outcome  && ledgerTrx.outcome.result === 'tesSUCCESS') {

                            
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
                                        &&(parseFloat(ledgerTrx.outcome.deliveredAmount.value)*1000000 == parseInt(amount.value)); //check value
                            }

                } else {
                    //transaction not valid
                    return false;
                }
            } else {
                return false;
            }
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }
}