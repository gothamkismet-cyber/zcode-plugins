# steam-workshop（Steam 创意工坊连接 + mod 代码分析）

给 ZCode 加七个 MCP 工具：`workshop_search` / `workshop_details` / `workshop_download` / `mod_analyze` / `mod_read_file` / `mod_grep` / `workshop_status`。查询任意游戏的创意工坊；把 mod 拿到本地并解析其代码与联动点，服务 RimWorld mod 兼容适配开发。

## 能力地图

| 层 | 工具 | 数据通道 |
| --- | --- | --- |
| 查询 | search / details | 有 key：官方 QueryFiles；无 key：社区页锚点解析（id+标题）+ 官方免 key 详情接口 |
| 取文件 | download | 本地 Steam 库（解析 libraryfolders.vdf）→ 下载缓存 → steamcmd 匿名下载 |
| 代码分析 | mod_analyze / mod_read_file / mod_grep | 纯本地：About.xml、loadFolders、Defs/Patches XML、C# 源码、DLL 二进制特征 |

RimWorld 深度解析产出 `integrationPoints`：modDependencies（含 isOptional）、loadBefore/loadAfter、mayRequire/mayRequireAnyOf（聚合到文件级）、loadFolders 条件加载、C# Harmony 补丁目标、PatchOperation 统计、DLL 特征标记（HarmonyPatch/StaticConstructorOnStartup/ModExtension）。

安全边界：mod 内文件读取带路径遏制（拒绝 `../` 越界）、二进制嗅探拒绝、文本预算与条数上限；steamcmd 只用官方参数匿名登录。

## 配置（可选，`~/.zcode/steam-workshop.json`）

```json
{
  "steamApiKey": "官方 QueryFiles 全字段搜索（steamcommunity.com/dev/apikey）",
  "steamcmdPath": "steamcmd.exe 完整路径（下载 mod 时需要）",
  "steamPath": "Steam 根目录（非默认安装时）",
  "steamLibraries": ["D:\\SteamLibrary"],
  "downloadRoot": "下载缓存目录，默认 ~/.zcode/steam-workshop-downloads"
}
```

也可用环境变量 `STEAM_API_KEY` / `STEAMCMD_PATH`。插件源码不含任何凭据。

## 实现说明

- 零依赖 Node ESM，逐行 JSON-RPC over stdio（与 ZCode 内置官方 MCP SDK 帧一致）。
- `.mcp.json` 带 `--use-system-ca`（本机代理 TLS 拦截实测必需）与 `NODE_USE_ENV_PROXY=1`。
- 免 key 搜索解析锚定 `sharedfiles/filedetails/?id=` 链接 + 图片 alt 标题（2026-09 实测社区新版式，哈希 class 不可靠）；去重上限 20 条/页。
- mod 文件来源优先级：`path` 直填 > Steam 库扫描（libraryfolders.vdf + 配置 steamLibraries）> 下载缓存 > steamcmd；`prefer:"download"` 与 `force` 会跳过本地与缓存强制走 steamcmd。
- mod 内文本按需部分读取（只缓冲上限字节，不整文件进内存）。

## 验证状态（2026-09-27）

- 免 key 详情、免 key 搜索解析、MCP 帧：实机实测通过（HugsLib 全字段；环世界搜索 20 条）。
- mod 分析链路：RimWorld 夹具 mod 25 项断言全过——About 依赖（含 optional）、loadAfter、mayRequire/mayRequireAnyOf 聚合、条件加载目录、Harmony 注解内容、Def 类型统计、defName、语言目录、DLL 二进制标记、About.xml 读取、`../` 越界拒绝、grep/glob、假库定位（config steamLibraries → local-workshop）、下载短路、steamcmd 缺失提示、search/details 回归。
- **未验证**：带 key 的 QueryFiles（无 key 无法实测）；steamcmd 实际下载（开发机未装 steamcmd，错误路径已测）；本机未发现真实 Steam 安装（标准路径无 libraryfolders.vdf），真实库扫描请装好后用 `workshop_status` 看 steam_libraries 是否识别。

## 限制

- 只读 Steam 元数据；下载走 steamcmd 匿名，被拒的游戏需订阅或缓存账号登录。
- 非 RimWorld mod 无深度解析（工具仍给文件树、文本读取和 grep）。
- 特大 mod 的 steamcmd 下载可能超出 MCP 客户端超时；重试会续传，或客户端订阅走本地路径。
