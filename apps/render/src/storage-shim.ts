// Sandboxed documents have an opaque origin, so touching localStorage or
// sessionStorage throws. Replace them with in-memory stores only when access
// fails (design.md 5.4). Static string: never interpolate user data here.
export const STORAGE_SHIM =
  "<script>(function(){function m(){var s=new Map();return{get length(){return s.size}," +
  "key:function(i){var k=Array.from(s.keys())[i];return k===undefined?null:k}," +
  "getItem:function(k){k=String(k);return s.has(k)?s.get(k):null}," +
  "setItem:function(k,v){s.set(String(k),String(v))}," +
  "removeItem:function(k){s.delete(String(k))},clear:function(){s.clear()}}}" +
  '["localStorage","sessionStorage"].forEach(function(n){try{window[n].length}catch(e){' +
  "try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch(_){}}})})();</script>";

const SCAN_BYTES = 64 * 1024;

// Finds where to insert the shim using only the first 64KB of the first chunk.
// latin1 decoding keeps string indexes equal to byte offsets.
export function shimInsertOffset(head: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(head.subarray(0, SCAN_BYTES));
  const headTag = /<head(?:\s[^>]*)?>/i.exec(text);
  if (headTag) return headTag.index + headTag[0].length;
  const doctype = /<!doctype[^>]*>/i.exec(text);
  if (doctype) return doctype.index + doctype[0].length;
  return 0;
}

const shimBytes = new TextEncoder().encode(STORAGE_SHIM);

export function injectStorageShim(firstChunk: Uint8Array): Uint8Array {
  const at = shimInsertOffset(firstChunk);
  const out = new Uint8Array(firstChunk.length + shimBytes.length);
  out.set(firstChunk.subarray(0, at), 0);
  out.set(shimBytes, at);
  out.set(firstChunk.subarray(at), at + shimBytes.length);
  return out;
}
