const path = require('path');
const { fetchGdFire, writeJsonAtomic } = require('./gd-fire');

const OUT = path.join(__dirname, '..', 'data', 'gd-fire.json');

async function main() {
  const payload = await fetchGdFire();
  await writeJsonAtomic(OUT, payload);
  console.log(`广东森林火险快照：${payload.count} 条，城市 ${payload.citiesOk}/${payload.citiesTotal}`);
}

main().catch((err) => {
  console.error(`广东森林火险快照未更新：${err.message}`);
  process.exitCode = 1;
});
