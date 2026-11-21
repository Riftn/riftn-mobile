@echo off
setlocal
pushd "%~dp0android" || exit /b 1
call gradlew.bat :app:assembleRelease %*
set "build_result=%errorlevel%"
popd
if not "%build_result%"=="0" exit /b %build_result%
echo APK output: android\app\build\outputs\apk\release
