'use strict';
const {createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
function createVault(key) {
  if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('A 256-bit session encryption key is required');
  return Object.freeze({
    seal(value,sessionHash){
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
      cipher.setAAD(Buffer.from(sessionHash));
      const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
      return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
    },
    open(value,sessionHash){
      const [version,nonce,tag,body,...extra]=String(value).split('.');
      if(version!=='v1'||!nonce||!tag||!body||extra.length)throw new Error('Invalid encrypted session');
      const iv=Buffer.from(nonce,'base64url'),authTag=Buffer.from(tag,'base64url');
      if(iv.length!==12||authTag.length!==16)throw new Error('Invalid encrypted session');
      const decipher=createDecipheriv('aes-256-gcm',key,iv);
      decipher.setAAD(Buffer.from(sessionHash));decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(Buffer.from(body,'base64url')),decipher.final()]).toString('utf8');
    }
  });
}
module.exports={createVault};
