@echo off
chcp 65001 > nul
setlocal

echo ============================================
echo   Cuckoo Code 一键发布脚本
echo ============================================
echo.

cd /d "%~dp0"

:: 获取当前版本号
for /f "tokens=2 delims=:," %%a in ('node -p "require('./package.json').version"') do set CUR_VER=%%~a
echo 当前版本: %CUR_VER%
echo.

:: 输入新版本号
set /p NEW_VER=请输入新版本号 (例如 0.1.5): 

if "%NEW_VER%"=="" (
  echo 版本号不能为空！
  pause
  exit /b 1
)

:: 校验版本号格式 x.y.z（用 node 校验，避免 findstr 的坑：
:: findstr 的 "." 匹配任意字符、对行尾空格/全角字符敏感，曾导致 0.8.10 被误判）
for /f "delims=" %%v in ('node -e "const v=process.argv[1].trim();process.stdout.write(v)" "%NEW_VER%"') do set NEW_VER=%%v
node -e "const v=process.argv[1];if(!/^[0-9]+.[0-9]+.[0-9]+$/.test(v)){console.error('版本号格式错误，应为 x.y.z 格式（实际输入：['+v+']）');process.exit(1)}" "%NEW_VER%"
if errorlevel 1 (
  echo 版本号格式错误，应为 x.y.z 格式，例如 0.1.5
  pause
  exit /b 1
)

echo.
echo ==== 1/5 更新版本号到 %NEW_VER% ====
node -e "const fs=require('fs');const p=require('./package.json');p.version='%NEW_VER%';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');const l=JSON.parse(fs.readFileSync('package-lock.json','utf8'));l.version='%NEW_VER%';if(l.packages&&l.packages[''])l.packages[''].version='%NEW_VER%';fs.writeFileSync('package-lock.json',JSON.stringify(l,null,2)+'\n');console.log('版本已更新');"
if errorlevel 1 (
  echo 版本号更新失败！
  pause
  exit /b 1
)

echo.
echo ==== 2/5 提交代码到本地 ====
git add package.json package-lock.json
git commit -m "chore: 升级版本到 %NEW_VER%"
if errorlevel 1 (
  echo 提交失败（可能没有改动或已提交）
)

echo.
echo ==== 3/5 推送代码到 GitHub ====
git push github master
if errorlevel 1 (
  echo 推送失败！请检查网络或代理设置。
  pause
  exit /b 1
)

echo.
echo ==== 4/5 创建并推送 tag v%NEW_VER% ====
git tag v%NEW_VER%
git push github v%NEW_VER%
if errorlevel 1 (
  echo tag 推送失败！
  pause
  exit /b 1
)

echo.
echo ==== 5/5 完成！ ====
echo GitHub Actions 已开始构建，稍后自动发布 Release。
echo.
echo 查看进度: https://github.com/wangyongpeng90/cuckoo-code/actions
echo 下载页面: https://github.com/wangyongpeng90/cuckoo-code/releases
echo.
pause
