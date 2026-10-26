'use strict';
const { resolve }=require('node:path');
const { openDatabase }=require('./database.cjs');
const { createApp }=require('./app.cjs');

// Deliberate release gate: this account implementation has not had independent
// security review, email verification/recovery or hosted-database provisioning.
if(process.env.NODE_ENV==='production') throw new Error('Local POC only. Complete the external-access release gates before production deployment.');
const host='127.0.0.1';
const port=Number(process.env.RELAY_POC_PORT||4180);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('RELAY_POC_PORT must be an integer from 1024 to 65535');
const origin=`http://${host}:${port}`;
const db=openDatabase(resolve(process.env.RELAY_DATABASE_PATH||resolve(__dirname,'../../../.poc-data/relay.sqlite')));
const server=createApp({db,origin});
server.on('error',error=>{ console.error(`POC failed to start (${error.code||'UNKNOWN'}).`);db.close();process.exitCode=1; });
server.listen(port,host,()=>console.log(`Relay account + task POC\nLocal: ${origin}\nPersistent accounts and tasks · published demo unchanged\nCtrl+C stops the server; data is retained.`));
let stopping=false;
function shutdown(){if(stopping)return;stopping=true;server.close(()=>{db.close();process.exitCode=0;});server.closeIdleConnections();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
