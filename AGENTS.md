# 项目开发约定

- 分牙阶段使用 `dev-fenya`；咬合碰撞和整颌调整保存在 `dev-yaohe`。不要混入其他功能分支的改动。
- 本项目使用 TypeScript、Vite 和 Three.js。开发端口 5186，预览端口 4186；在线推理适配服务端口 5187。命令及使用说明见 `README.md`。
- 默认导入整个本地数据文件夹，读取已有分牙 JSON。文件夹模式遇到标签错误应提示并阻止进入分牙，不能自动调用在线推理。单文件上传保留在线自动分牙。
- 预处理加载后，顶部“分牙”在处理期间转圈，所有模型标签准备好后才可进入。保持原始模型坐标和上下颌位置关系。
- 保留 FDI 配色规则：11/31 同色、21/41 同色。牙号气泡锚点在模型坐标中固定，随模型变化，允许重叠，不做碰撞避让或贴边重排；气泡与引线必须参与牙模深度遮挡。
- “调整分牙”按 `docs/adjust-segmentation-requirements.md` 实现四步双颌编辑；新增龈牙线、AI 重提与步骤下拉仍保留占位。修改只保存在页面会话，不写回输入文件。
- 相关实现：`src/folder-import.mjs` 发现病例；`src/model-import.mjs` 管理异步加载；`src/segmentation.mjs` 映射标签和生成固定锚点；`src/tooth-labels.ts` 绘制三维标注；`src/main.ts` 管理流程和场景。
- 编辑实现：`src/segmentation-editor.mjs` 管理稳定区域身份、面片拓扑、表面路径、穿透圈选和全颌差量历史；`src/adjustment.ts` 管理四步界面、曲面拾取、牙号浮窗和会话确认。编号及 B/I 属于区域元数据，S 的编号为 null；不要通过颜色反推归属。
- 代码验证使用 `npm.cmd test`、`npm.cmd run build`；推理适配层变动另运行 `python -m unittest discover -s server -p test_api.py`。渲染改动需浏览器验证；截图放入已忽略的 `test-results/`。
- 阶段状态与验证范围见 `docs/segmentation-handoff.md`。更新实现时同步对应文档，不将病例数据、权重、凭据或生成产物加入 Git。
