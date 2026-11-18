(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RelayRequest=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  class ApiError extends Error { constructor(message,status,code){super(message);this.status=status;this.code=code;} }
  async function request(path,options={},dependencies={}){
    const {managed=false,onSlow=()=>{},...fetchOptions}=options;
    const fetchImpl=dependencies.fetchImpl||fetch;
    const schedule=dependencies.schedule||setTimeout,cancel=dependencies.cancel||clearTimeout;
    const controller=new AbortController();
    const timeout=schedule(()=>controller.abort(),managed?75000:12000);
    const slow=managed?schedule(onSlow,5000):null;
    const emailRequest=/^\/api\/auth\/(register|resend|recover)$/.test(path);
    try{
      // Never automatically replay a mutation: a lost response does not prove it failed.
      const response=await fetchImpl(path,{...fetchOptions,signal:controller.signal});
      let data;
      try{data=await response.json();}catch{
        throw new ApiError(emailRequest?'We couldn’t confirm the email request. Check your inbox and spam folder before requesting another email.':'Staging did not return a complete response. Your text is still here; please try again shortly.',503,'INCOMPLETE_RESPONSE');
      }
      if(!response.ok)throw new ApiError(data.error?.message||'The request failed.',response.status,data.error?.code);
      return data;
    }catch(error){
      if(error instanceof ApiError)throw error;
      throw new ApiError(emailRequest?'We couldn’t confirm the email request. Check your inbox and spam folder before requesting another email.':'Connection interrupted. Your text is still here. Please try again.',0,'CONNECTION_INTERRUPTED');
    }finally{cancel(timeout);if(slow!==null)cancel(slow);}
  }
  return Object.freeze({request,ApiError});
});
