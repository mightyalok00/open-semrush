import test from 'node:test';import assert from 'node:assert/strict';import { assertPublicHttpUrl,isPublicIpAddress,safeFetch } from '../dist/url-safety.js';
test('blocks IPv4 special-purpose, documentation, multicast and private ranges',()=>{for(const ip of ['0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.169.254','172.20.1.1','192.0.0.8','192.0.2.1','192.88.99.1','192.168.1.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255'])assert.equal(isPublicIpAddress(ip),false,ip);assert.equal(isPublicIpAddress('1.1.1.1'),true);});
test('blocks non-global IPv6, transition, documentation and mapped addresses',()=>{for(const ip of ['::','::1','fc00::1','fd00::1','fe80::1','ff02::1','2001:db8::1','2001::1','2002::1','::ffff:8.8.8.8'])assert.equal(isPublicIpAddress(ip),false,ip);assert.equal(isPublicIpAddress('2606:4700:4700::1111'),true);});
test('rejects unsafe hosts and protocols',async()=>{for(const u of ['file:///etc/passwd','http://localhost/','http://x.local/','http://metadata.google.internal/','http://127.0.0.1/','http://169.254.169.254/','https://user:pass@example.com/'])await assert.rejects(assertPublicHttpUrl(u));});


test('rejects a mixed public/private DNS answer before connecting',async()=>{
 const resolver=async()=>[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}];
 await assert.rejects(assertPublicHttpUrl('https://example.com/',resolver),/private or reserved/);
});
test('pins the checked DNS answer and does not resolve again for the socket',async()=>{
 let resolutions=0,connectedAddress='';
 const resolver=async()=>{resolutions++;return [{address:resolutions===1?'93.184.216.34':'127.0.0.1',family:4}];};
 const requester=async(_url,address)=>{connectedAddress=address;return new Response('ok',{status:200});};
 const response=await safeFetch('https://example.com/',{}, {resolver,requester});
 assert.equal(await response.text(),'ok');
 assert.equal(resolutions,1);
 assert.equal(connectedAddress,'93.184.216.34');
});
test('redirect targets are revalidated before connecting',async()=>{
 let calls=0;
 const resolver=async()=>[{address:'93.184.216.34',family:4}];
 const requester=async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/admin'}});};
 await assert.rejects(safeFetch('https://example.com/',{}, {resolver,requester}),/Private or reserved IP/);
 assert.equal(calls,1);
});
