/** 对象库中可由 SQLite 安全引用的内容寻址元数据。 */
export interface ObjectReference {
  sha256: string;
  byteLength: number;
  mediaType: string;
}

export interface PutObjectInput {
  content: Uint8Array;
  mediaType: string;
}

export interface ObjectStore {
  put(input: PutObjectInput): Promise<ObjectReference>;
  read(sha256: string): Promise<Uint8Array>;
}
