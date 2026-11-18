'use strict';
const {loadConfig}=require('./config.cjs');
const {createProvider}=require('./provider.cjs');
const {createManagedStore}=require('./store.cjs');
const {createApp}=require('../../poc-api/src/app.cjs');
async function start(){
  const config=loadConfig();
  const port=Number(process.env.PORT||10000);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PORT');
  const provider=createProvider(config);
  await provider.ready();
  const store=createManagedStore({provider,sessionKey:config.sessionKey});
  const server=createApp({origin:config.origin,store,mode:'managed-staging'});
  server.on('error',()=>{console.error('Staging server failed to bind.');process.exitCode=1;});
  server.listen(port,'0.0.0.0',()=>console.log('Relay managed staging listening. No credentials or task data are logged.'));
  let stopping=false;
  const shutdown=()=>{if(stopping)return;stopping=true;server.close(()=>{process.exitCode=0;});server.closeIdleConnections();};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
start().catch(()=>{console.error('Staging startup failed. Check required configuration, credentials and applied migrations.');process.exitCode=1;});
