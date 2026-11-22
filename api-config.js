/* 本地由 scripts/serve.js 提供 /api；Qoder Sites 上由同源的边缘函数提供（/functions/v1/app）；
   GitHub Pages 等纯静态托管没有 Node 进程，广州/江门雷达和资讯改走 CloudBase 接口。
   东莞、珠海、佛山、澳门可跨站直连，不经过云函数，以节省免费额度。
   公告栏和管理页通过 QXKSH_ANNOUNCE_API 访问同一个函数。
   Qoder Sites 是公开参赛站点，雷达口令门在那里关闭；本地、局域网和 GitHub Pages 仍保留。 */
(function () {
  var host = location.hostname;
  var onSites = /\.qoder\.(site|website)$/i.test(host);
  var local = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0'
    || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  // CloudBase HTTP 访问服务根地址（不要带结尾斜杠），函数里包含雷达、新闻和公告接口。
  var CLOUD_API = 'https://nov-weather1-gonggao-d2a0f393f4b.service.tcloudbase.com';
  var API_BASE = onSites ? '/functions/v1/app' : (local ? '' : CLOUD_API);

  // 公告接口独立地址：填 CloudBase HTTP 访问服务地址（不要带结尾斜杠），
  // 留空时前端直接读取 data/announcements.json。部署步骤见 DEPLOY-CLOUDBASE.md。
  var ANNOUNCE_API = CLOUD_API;

  window.QXKSH_RADAR_GATE = !onSites;
  window.QXKSH_API_BASE = String(API_BASE || '').replace(/\/+$/, '');
  window.QXKSH_ANNOUNCE_API = window.QXKSH_ANNOUNCE_API
    || String(ANNOUNCE_API || '').replace(/\/+$/, '');
  window.qxApi = function qxApi(path) {
    var suffix = path.charAt(0) === '/' ? path : '/' + path;
    return window.QXKSH_API_BASE + suffix;
  };
})();