import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseCss,consolidateCss,cssWinners,formatCss} from '../scripts/css-rules.mjs';

test('CSS consolidation preserves important declarations, media conditions and shorthand ordering',()=>{
 const before=parseCss('#a{padding:4px;color:red!important} #b{color:pink} #a{padding:8px;color:blue;padding-left:12px}@media(max-width:600px){#a{padding:1px}#a{padding:2px}}');
 const result=consolidateCss(before);assert.ok(result.removed>0);assert.deepEqual(cssWinners(result.nodes),cssWinners(before));assert.match(formatCss(result.nodes),/padding-left: 12px/);
});
test('CSS parser preserves strings and nested function values and rejects broken blocks',()=>{
 const text='#a::before{content:"a;b:{}";width:calc(100% - var(--x, 2px));}';assert.deepEqual(cssWinners(parseCss(formatCss(parseCss(text)))),cssWinners(parseCss(text)));assert.throws(()=>parseCss('#a{color:red'),/Unclosed/);
});
test('production styles have no repeat overrides for the same selector in the same condition',async()=>{
 for(const file of ['editor.css','consumer.css']){const nodes=parseCss(await fs.readFile(new URL('../'+file,import.meta.url),'utf8')),result=consolidateCss(nodes);assert.equal(result.removed,0,file);assert.deepEqual(cssWinners(result.nodes),cssWinners(nodes));}
});
