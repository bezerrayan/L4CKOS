@echo off
cd /d "C:\Program Files\MySQL\MySQL Server 9.6\bin"
mysql.exe -u root -p < "C:\Users\Yan\Documents\l4ckos\l4ckos-workspace\l4ckos-final\l4ckos-store\seed.sql"
echo.
echo Produtos inseridos com sucesso!
echo.
pause
