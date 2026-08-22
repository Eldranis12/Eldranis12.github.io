<?php
// Router untuk PHP built-in server (dev/test): meniru rewrite .htaccess.
//   php -S 127.0.0.1:8787 router-dev.php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . $path;
if ($path !== '/' && is_file($file) && !str_ends_with($path, '/config.php')) return false;
require __DIR__ . '/index.php';
