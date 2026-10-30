const fs = require('fs/promises');
const path = require('path');
const { SOURCE, beijingYear, validYear, fetchNmc, writeJsonAtomic } = require('./nmc-typhoon');

const OUT = path.join(__dirname, '..', 'data', 'typhoons-nmc.json');

function selectRows(rows) {
  const active = rows.filter((row) => row[7] === 'start');
  const ended = rows.filter((row) => row[7] === 'stop')
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .slice(0, 3);
  return [...active, ...ended];
}

function trimForecasts(detail) {
  const points = detail.typhoon[8];
  return {
    ...detail,
    typhoon: detail.typhoon.map((value, index) => {
      if (index !== 8) return value;
      return points.map((point, pointIndex) => {
        if (pointIndex === points.length - 1) return point;
        return [...point.slice(0, 11), null, point[12]];
      });
    }),
  };
}

async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length === 1 && !validYear(args[0]))) {
    throw new Error(`年份须为 1949 至北京时间 ${beijingYear()} 年内的四位数字（仅接受一个年份参数）`);
  }
  const year = args.length ? Number(args[0]) : beijingYear();
  const list = await fetchNmc('list', year);
  const selected = selectRows(list.typhoonList);
  const details = new Array(selected.length);
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const index = cursor++;
      const id = String(selected[index][0]);
      details[index] = [id, trimForecasts(await fetchNmc('detail', id))];
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
  const snapshot = { source: SOURCE, fetchedAt: new Date().toISOString(), year, list, storms: Object.fromEntries(details) };
  await writeJsonAtomic(OUT, snapshot);
  const bytes = (await fs.stat(OUT)).size;
  console.log(`中央气象台台风快照：${year} 年，列表 ${list.typhoonList.length} 条，详情 ${details.length} 个，${Math.round(bytes / 1024)} KB`);
}

main().catch((err) => {
  console.error(`中央气象台台风快照未更新：${err.message}`);
  process.exitCode = 1;
});
