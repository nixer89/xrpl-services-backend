import { XummTypes } from 'xumm-sdk';

export interface GenericBackendPostRequest {
    options?: GenericBackendPostRequestOptions,
    payload: XummTypes.XummPostPayloadBodyJson
}

export interface GenericBackendPostRequestOptions {
    frontendId?: string,
    web?: boolean,
    pushDisabled?: boolean,
    referer?: string,
    xrplAccount?: string,
    signinToValidate?: boolean,
    issuing?: boolean,
    isRawTrx?: boolean
}

export interface TransactionValidation {
    success: boolean,
    testnet: boolean,
    txid?: string,
    error?: boolean,
    message?: string,
    payloadExpired?: boolean,
    noValidationTimeFrame?: boolean,
    redirect?: boolean,
    account?: string
}

export interface AllowedOrigins {
    origin: string,
    applicationId: string,
    destinationAccount?: string,
    destinationTag?: number,
    fixAmount?: any,
    payloadValidationTimeframe?: any,
    return_urls?: any[]
}

export interface ApplicationApiKeys {
    xumm_app_id: string,
    xumm_app_secret: string
}

export interface FrontendIdPayloadCollection {
    applicationId: string,
    frontendUserId: string,
    origin: string,
    referer?: string,
    updated: Date,
    [key: string]: any,
}

export interface UserIdCollection {
    origin: string,
    applicationId: string,
    frontendUserId: string,
    xummUserId: string,
    created: Date
}

export interface XummIdPayloadCollection {
    origin: string,
    applicationId: string,
    referer?: string,
    xummUserId: string,
    [key: string]: any,
    updated: Date
}

export interface XrplAccountPayloadCollection {
    applicationId: string,
    origin: string,
    referer?: string,
    xrplAccount: string,
    xummId?: string,
    [key: string]: any,
    updated: Date
}

export interface StatisticsCollection {
    applicationId: string,
    origin: string,
    stats: any,
    updated: Date
}