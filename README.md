# 词刻 · 英语词汇学习

一个面向中文英语学习者的可选词库学习网页。每个词库都可以自行设置学习天数，系统根据总词数自动计算每天词量并重新分组。

在线使用：[https://sange1022.github.io/english-vocabulary-study/](https://sange1022.github.io/english-vocabulary-study/)

作者：戌無营造

内置词库：

- 日常口语进阶 3000：按 SUBTLEX-US 电影和电视字幕口语频率排序，过滤过于基础的功能词，并用 ECDICT 补充中文释义、音标和英文释义。
- 李笑来 TOEFL 核心词汇 2115：从用户提供的扫描版原书中识别，保留可确认的释义、例句、派生词和近义词；原文件缺失的详情页会在词卡中明确标注。
- TOEFL 核心示例：用于演示学术词汇学习和导入完整词表。

支持顺序学习、本轮不重复的随机学习、键盘操作、浏览器发音、错词本、随机分组、词表导入和本地进度保存。

## 本地运行

```bash
npm install
npm run start
```

生产构建：

```bash
npm run typecheck
npm run build
```

## 导入词表

导入的词会追加到当前选中的词库，并参与自动按天分组。支持 UTF-8 CSV 或 JSON；CSV 首行字段为：

```csv
word,phonetic,meaning,example,translation
photosynthesis,/ˌfoʊtoʊˈsɪnθəsɪs/,n. 光合作用,Photosynthesis converts light into chemical energy.,光合作用将光能转化为化学能。
```

- `word` 和 `meaning` 必填。
- 学习天数不写入词表，由界面中的“计划天数”统一控制。
- 进度、计划设置和导入内容保存在浏览器 `localStorage`，无需后端。

## 数据与开源来源

- 日常口语排序参考 [SUBTLEX-US word frequencies](https://github.com/words/subtlex-word-frequencies)，该数据包采用 ISC 许可，并注明来源为 SUBTLEX-US 美国电影和电视字幕语料。
- 中文释义和音标来自 MIT 许可的 [ECDICT](https://github.com/skywind3000/ECDICT)。
- 项目基于 MIT 许可的 [tnm/hsk](https://github.com/tnm/hsk) 改造，保留其 React + Vite 技术基础与 MIT 许可证。

《TOEFL 核心词汇 21 天突破》词库由用户提供的扫描版文件在本地识别生成，没有从第三方词表仓库复制。
