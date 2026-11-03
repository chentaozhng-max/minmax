/**
 * 逐字比对改前/改后的页面文字。
 *
 * 为什么需要这个：npm run accept 只测 API 和数据一致性，**完全不渲染页面**。
 * 所以把页面里的 prisma 搬走之后，accept 22/0 全绿也不能证明页面没坏。
 * 唯一能证明的办法是：改之前存一份渲染出来的文字，改完之后再存一份，逐字比。
 *
 * 用法：node scripts/_check-page-baseline.mjs <baseline.html> <after.html>
 */

import { readFileSync } from "node:fs";

function extractText(file) {
  const html = readFileSync(file, "utf8");
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const [, , baseFile, afterFile] = process.argv;
if (!baseFile || !afterFile) {
  console.error("用法: node scripts/_check-page-baseline.mjs <base.html> <after.html>");
  process.exit(2);
}

const base = extractText(baseFile);
const after = extractText(afterFile);

if (base === after) {
  console.log(`✅ 文字完全一致（${base.length} 字）— ${afterFile}`);
  process.exit(0);
}

console.log(`❌ 文字不一致`);
console.log(`  基线 ${base.length} 字 / 改后 ${after.length} 字`);

// 找出第一处不同，给出上下文，方便定位
let i = 0;
while (i < base.length && i < after.length && base[i] === after[i]) i++;
const from = Math.max(0, i - 40);
console.log(`  首个差异在第 ${i} 字：`);
console.log(`    基线: …${base.slice(from, i + 60)}…`);
console.log(`    改后: …${after.slice(from, i + 60)}…`);
process.exit(1);
