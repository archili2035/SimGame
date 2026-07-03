# SimGame — B站模拟经营游戏雷达

每周一自动扫描过去 14~7 天 B站上的模拟经营 / 经营建造 / Tycoon / 城建 / 种田 / 工厂 / 殖民地经营等相关视频，按游戏聚合，生成周报并合并进累积式可视化页面。设计灵感与市场热度并重。

- 在线页面：https://archili2035.github.io/SimGame/
- 权威数据源：`data.json`
- 可视化页面：`index.html`（数据区由 `scripts/merge.mjs` 机械回填，禁止手工编辑）
- 周报归档：`reports/YYYY-Www_B站模拟经营游戏周报.md`

## 数据流

1. 周扫描生成临时 `_week.json`
2. `node scripts/merge.mjs --append _week.json` 校验 + 追加进 `data.json` + 回填 `index.html`
3. `git push` 到本仓库，GitHub Pages 自动重建

题材边界：模拟经营 / 经营建造为核心；沙盒生存建造、管理调度等强经营循环邻近品类标 `外延`。
