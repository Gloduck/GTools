// 本机和 SSH 共用排查模板；仅复制主命令，不安装程序，也不保证系统具备全部命令。
// 命令参数可能产生修改行为，高风险用法即使命中模板也必须审批。
export const COMMAND_WHITELIST_TEMPLATES = Object.freeze({
    sh: [
        // 文件、文本、日志及校验。
        'pwd', 'ls', 'cat', 'less', 'more', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'awk', 'sed',
        'sort', 'uniq', 'wc', 'cut', 'tr', 'tee', 'xargs', 'find', 'stat', 'file', 'readlink', 'realpath',
        'basename', 'dirname', 'tree', 'printf', 'echo', 'diff', 'cmp', 'od', 'hexdump', 'strings',
        'md5sum', 'sha256sum', 'shasum', 'cksum',
        // 环境、用户与系统信息。
        'env', 'printenv', 'set', 'locale', 'which', 'whereis', 'type', 'command', 'history', 'alias',
        'whoami', 'id', 'groups', 'who', 'w', 'last', 'lastlog', 'date', 'uptime', 'hostname', 'uname',
        'arch', 'lscpu', 'lsmem', 'lsblk', 'lspci', 'lsusb', 'dmidecode', 'dmesg', 'getent', 'lsmod', 'modinfo', 'lsns',
        // 进程、内存、负载与磁盘。
        'ps', 'pstree', 'pgrep', 'top', 'htop', 'free', 'vmstat', 'iostat', 'mpstat', 'sar', 'pidstat', 'pmap', 'lsof', 'strace',
        'df', 'du', 'mount', 'findmnt', 'blkid', 'lsattr', 'getfacl',
        // 网络、DNS、路由、证书与连接排查。
        'ip', 'ss', 'netstat', 'ping', 'ping6', 'traceroute', 'tracepath', 'dig', 'nslookup', 'host',
        'curl', 'wget', 'nc', 'telnet', 'arp', 'route', 'ifconfig', 'nstat', 'openssl',
        // Linux 服务、日志、时钟与软件包信息。
        'systemctl', 'service', 'journalctl', 'loginctl', 'timedatectl', 'resolvectl', 'hostnamectl', 'localectl',
        'crontab', 'apt-cache', 'dpkg-query', 'rpm', 'sysctl',
        // macOS 系统、内存、网络、电源与日志排查。
        'sw_vers', 'system_profiler', 'vm_stat', 'memory_pressure', 'diskutil', 'networksetup', 'scutil', 'pmset', 'launchctl', 'log',
    ].join('\n'),
    powershell: [
        // 文件、文本、权限及输出整理。
        'Get-Location', 'Get-ChildItem', 'Get-Content', 'Get-Item', 'Get-ItemProperty', 'Get-ItemPropertyValue',
        'Test-Path', 'Resolve-Path', 'Split-Path', 'Join-Path', 'Get-Acl', 'Get-FileHash',
        'Select-Object', 'Where-Object', 'Sort-Object', 'Group-Object', 'Measure-Object', 'Compare-Object',
        'Select-String', 'Format-List', 'Format-Table', 'Out-String', 'Write-Output', 'ConvertTo-Json', 'ConvertFrom-Json',
        // 系统、进程、服务、事件、计划任务与性能。
        'Get-Process', 'Get-Service', 'Get-Date', 'Get-Command', 'Get-Help', 'Get-Host', 'Get-Module',
        'Get-ComputerInfo', 'Get-CimInstance', 'Get-WmiObject', 'Get-Counter', 'Get-WinEvent', 'Get-EventLog',
        'Get-HotFix', 'Get-ScheduledTask', 'Get-ScheduledTaskInfo', 'Get-TimeZone',
        // 磁盘、卷与网络诊断。
        'Get-PSDrive', 'Get-Disk', 'Get-Partition', 'Get-Volume', 'Get-PhysicalDisk', 'Get-StoragePool',
        'Get-NetAdapter', 'Get-NetIPConfiguration', 'Get-NetIPAddress', 'Get-NetIPInterface',
        'Get-NetRoute', 'Get-NetNeighbor', 'Get-NetTCPConnection', 'Get-NetUDPEndpoint',
        'Get-DnsClient', 'Get-DnsClientServerAddress', 'Get-DnsClientCache', 'Get-NetConnectionProfile',
        'Get-NetFirewallProfile', 'Get-NetFirewallRule', 'Test-NetConnection', 'Test-Connection', 'Resolve-DnsName',
        // 常见只读别名及系统诊断工具。
        'pwd', 'ls', 'dir', 'cat', 'gc', 'gci', 'echo', 'whoami', 'hostname', 'systeminfo', 'tasklist',
        'ipconfig', 'getmac', 'ping', 'tracert', 'pathping', 'nslookup', 'netstat', 'arp', 'route',
    ].join('\n'),
    cmd: [
        // 文件、环境、用户及系统信息。
        'cd', 'dir', 'type', 'more', 'find', 'findstr', 'sort', 'where', 'echo', 'tree', 'fc', 'comp',
        'whoami', 'hostname', 'ver', 'vol', 'set', 'systeminfo', 'driverquery',
        // 进程、服务、事件日志、任务与网络排查。
        'tasklist', 'sc', 'wevtutil', 'schtasks', 'ipconfig', 'getmac', 'ping', 'tracert', 'pathping',
        'nslookup', 'netstat', 'arp', 'route', 'net', 'netsh', 'w32tm',
    ].join('\n'),
});
