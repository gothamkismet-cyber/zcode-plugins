---
name: steam-workshop
description: Steam Workshop (创意工坊) access and mod code analysis via MCP tools. Use when the user mentions steam, 创意工坊, workshop, mod/模组搜索/下载/分析/适配/联动/兼容, Harmony, PatchOperation, MayRequire, About.xml, wants to find or inspect workshop items, or wants help developing RimWorld mod compatibility patches. Provides workshop_search / workshop_details / workshop_download / mod_analyze / mod_read_file / mod_grep / workshop_status.
---

# Steam 创意工坊（steam-workshop）

本插件通过 MCP 给 ZCode 加了七个工具：三个查创意工坊、四个拿 mod 文件并分析代码（RimWorld 深度）。只读 Steam 数据、不需要 Steam 账号登录。

| 工具 | 用途 |
| --- | --- |
| `workshop_search` | 关键词搜索某游戏创意工坊（appid 必填） |
| `workshop_details` | 查 1-20 个物品详情（免 key）；合集返回 children |
| `workshop_download` | 本地库/缓存已有就直接给路径，没有则 steamcmd 匿名下载 |
| `mod_analyze` | **联动/适配第一步**：解析 mod 的依赖、加载序、MayRequire、补丁、Harmony 注入点 |
| `mod_read_file` | 读 mod 内单个文本文件（路径限制在 mod 目录内） |
| `mod_grep` | 全 mod 文本搜索（file:line:内容，支持正则和 glob） |
| `workshop_status` | 自检 key/steamcmd/库路径/网络连通性 |

## 查物品（搜索+详情）

1. **appid 必填**：AppID 是商店页 URL 数字（`store.steampowered.com/app/<AppID>/`）；常用游戏对照表见下。
2. **无 key 降级**：搜索只回 id+标题，**立刻用 `workshop_details` 补全**再答复，别拿半截数据交差。
3. 异常先 `workshop_status`（证书错误→代理 MITM；连接失败→需要代理）。

## 做 mod 联动/兼容适配的标准流程

1. 拿到目标 mod：`mod_analyze {appid, publishedfileid}`（自动本地优先，缺了走 steamcmd 下载）。
2. 读 `integrationPoints`：
   - `modDependencies`/`loadAfter`/`loadBefore` → 加载顺序和硬依赖（isOptional 是软依赖）
   - `mayRequire` / `mayRequireAnyOf` → 这个 mod 预留的可选联动点（谁在场就启用哪段 XML）
   - `conditionalFolders` → loadFolders 的 ifModActive 条件加载
   - `harmonyPatches` → C# 补丁注入的宿主方法（写兼容补丁时避开同一方法冲突）
   - `structure.patchOperations` → 它对别人 defs 打了哪些补丁（PatchOperation 类名统计）
3. `mod_grep` 定位关心内容（如 `pattern:"MayRequire"`、`glob:"Source/*.cs"` 找 Harmony），`mod_read_file` 精读关键文件。
4. 给自己的 mod 写适配：在 Patches 用 `MayRequire="对方packageId"` 包住联动 XML；依赖顺序写进自己 About.xml 的 modDependencies/loadAfter。
5. 只有 DLL 没有源码的 mod：`assemblyMarkers` 只是二进制启发式，深度分析建议 ILSpy/dnSpy 反编译后再走上面的流程。

## 常用游戏 AppID

| 游戏 | AppID |
| --- | --- |
| 环世界 RimWorld | 294100 |
| 饥荒联机 Don't Starve Together | 322330 |
| 城市：天际线 Cities: Skylines | 255710 |
| 僵尸毁灭工程 Project Zomboid | 108600 |
| 壁纸引擎 Wallpaper Engine | 431960 |
| 武装突袭 3 Arma 3 | 107410 |
| 求生之路 2 Left 4 Dead 2 | 550 |
| 盖瑞模组 Garry's Mod | 4000 |
| 群星 Stellaris | 281990 |
| 欧洲卡车模拟 2 | 227300 |
| 太空工程师 Space Engineers | 244850 |

## 配置（全部可选，`C:\Users\<用户名>\.zcode\steam-workshop.json`）

```json
{
  "steamApiKey": "搜索升级为官方 QueryFiles 全字段（steamcommunity.com/dev/apikey 免费）",
  "steamcmdPath": "C:\\steamcmd\\steamcmd.exe（要下载 mod 时需要）",
  "steamPath": "非默认安装位置的 Steam 根目录",
  "steamLibraries": ["D:\\SteamLibrary"],
  "downloadRoot": "steamcmd 下载缓存目录，默认 ~/.zcode/steam-workshop-downloads"
}
```

- Steam 装在非默认位置且库没被扫到时，把库根目录（含 steamapps 的那层）加进 `steamLibraries`。
- steamcmd 匿名下载被拒的游戏：Steam 客户端订阅后走本地路径，或 steamcmd 交互式 login 一次缓存账号。
- key 属于用户凭据：不要把值写进任何项目文件或回复里。
