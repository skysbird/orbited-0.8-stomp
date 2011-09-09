all:
	jsio_compile orbited.pkg -j jsio -o ../static/Orbited.js 
	jsio_compile orbited.pkg -j jsio -o ../static/Orbited.min.js 
	cp ../static/Orbited.min.js ../static/Orbited.min.js.bak
	rm ../static/Orbited.min.js.gz
	gzip ../static/Orbited.min.js
	mv ../static/Orbited.min.js.bak ../static/Orbited.min.js
clean:
	rm ../static/*.js
	rm ../static/*.js.gz
