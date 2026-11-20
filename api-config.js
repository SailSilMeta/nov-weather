/* 本地由 scripts/serve.js 提供 /api；Qoder Sites 上由同源的边缘函数提供（/functions/v1/app）。
   其他静态托管没有 Node 进程，需把函数地址填到 API_BASE（不要带结尾斜杠），详细步骤见 DEPLOY-ALIYUN.md。
   Qoder Sites 是公开参赛站点，雷达口令门在那里关闭；本地和局域网仍保留。 */
(function () {
  var onSites = /\.qoder\.(site|website)$/i.test(location.hostname);
  var API_BASE = onSites ? '/functions/v1/app' : '';

  window.QXKSH_RADAR_GATE = !onSites;
  window.QXKSH_API_BASE = String(API_BASE || '').replace(/\/+$/, '');
  window.qxApi = function qxApi(path) {
    var suffix = path.charAt(0) === '/' ? path : '/' + path;
    return window.QXKSH_API_BASE + suffix;
  };
})();
