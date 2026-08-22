import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const M = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.woff2':'font/woff2','.wasm':'application/wasm','.xml':'application/xml','.txt':'text/plain' };
createServer(async (q,r)=>{const u=decodeURIComponent(new URL(q.url,'http://x').pathname);let f=join('dist',u);
if(existsSync(f)&&statSync(f).isDirectory())f=join(f,'index.html');
if(!existsSync(f)){r.writeHead(404,{'content-type':'text/html; charset=utf-8'}).end(await readFile('dist/404.html'));return;}
r.writeHead(200,{'content-type':M[extname(f)]??'application/octet-stream'}).end(await readFile(f));}).listen(4399,'127.0.0.1');
