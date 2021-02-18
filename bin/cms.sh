HOMEDIR=$(dirname $(readlink -f $0))
input=${2:--}
key_file=${key_file:-$HOMEDIR/../conf/cronicle.key}

if [ "$1" == "e" ] || [ "$1" == "encrypt" ] ; then
 cat $input | openssl cms -encrypt -outform PEM $key_file
elif [ "$1" == "d" ] || [ "$1" == "decrypt" ] ; then
  cat $input | openssl cms -decrypt -inform PEM -inkey $key_file -passin pass:$pass
elif [ "$1" == "m" ] || [ "$1" == "message" ]; then
   cat $input | openssl cms -cmsout -inform PEM -outform DER | openssl pkcs7 -inform DER -print -noout
elif [ "$1" == "serial" ]; then
    cat $input | openssl x509 -noout -serial  | sed 's/serial=//'
elif [ $1 == "subj" ] || [ $1 == "subject" ]; then
    cat $input | openssl x509 -noout -subject | sed 's/subject=CN = //'
elif [ "$1" == "new" ]; then
     if [ -z $2 ]; then
        echo 'must specify cert name'
        exit 1
     fi
     openssl req -x509 -sha256 -nodes -days 365 -keyout - -newkey rsa:4096 -subj "/CN=$2" -addext extendedKeyUsage=1.3.6.1.4.1.311.80.1 -addext keyUsage=keyEncipherment 2>/dev/null
else
    echo 'invalid command'
fi
