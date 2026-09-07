export interface ClaimedCollectorBatchReadRequest {
  readonly collectorId: string;
  readonly batchId: string;
  readonly processingFileName: string;
  readonly byteLength: number;
}

export interface IClaimedCollectorBatchReader {
  read(request: ClaimedCollectorBatchReadRequest): Promise<Uint8Array>;
}
