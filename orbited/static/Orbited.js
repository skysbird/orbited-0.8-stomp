// Copyright (c) 2010
// Michael Carter (cartermichael@gmail.com)
// Martin Hunt (mghunt@gmail.com)
// 
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// Initialization of js.io occurs in a closure, preventing local variables
// from entering the global scope.  During execution, the method `jsio` is
// added to the global scope.

;(function() {
	function init(cloneFrom) {
		// We expect this code to be minified before production use, so we may
		// write code slightly more verbosely than we otherwise would.
	
		// Should we parse syntax errors in the browser?
		var DEBUG = true;
	
		// Store a reference to the slice function for converting objects of
		// type arguments to type array.
		var SLICE = Array.prototype.slice;
	
		// js.io supports multiple JavaScript environments such as node.js and
		// most web browsers (IE, Firefox, WebKit).  The ENV object wraps 
		// any utility functions that contain environment-specific code (e.g.
		// reading a file using node's `fs` library or a browser's
		// `XMLHttpRequest`).  Running js.io in other JavaScript environments
		// is as easy as implementing an environment object that conforms to 
		// the abstract interface for an environment (provided below) and 
		// calling `jsio.setEnv()`.
		var ENV;
	
		// Checks if the last character in a string is `/`.
		var rexpEndSlash = /\/$/;
	
		// Creates an object containing metadata about a module.
		function makeModuleDef(path, baseMod, basePath) {
			var def = util.splitPath(path + '.js');
			if (baseMod) {
				def.baseMod = baseMod;
				def.basePath = basePath;
			}
			return def;
		}
	
		// Utility functions
		var util = {
				// `util.bind` returns a function that, when called, will execute
				// the method passed in with the provided context and any additional
				// arguments passed to `util.bind`.
				//       util.bind(obj, 'f', a) -> function() { return obj.f(a); }
				//       util.bind(obj, g, a, b, c) -> function() { return g.call(g, a, b, c); }
				bind: function(context, method/*, args... */) {
					var args = SLICE.call(arguments, 2);
					return function() {
						method = (typeof method == 'string' ? context[method] : method);
						return method.apply(context, args.concat(SLICE.call(arguments, 0)));
					};
				},
			
				// `util.addEndSlash` accepts a string.  That string is returned with a `/`
				// appended if the string did not already end in a `/`.
				addEndSlash: function(str) {
					return rexpEndSlash.test(str) ? str : str + '/';
				},
			
				// `util.removeEndSlash` accepts a string.  It removes a trailing `/` if
				// one is found.
				removeEndSlash: function(str) {
					return str.replace(rexpEndSlash, '');
				},
			
				// `util.makeRelativePath` accepts two paths (strings) and returns the first path
				// made relative to the second.  Note: this function needs some work.  It currently
				// handles the most common use cases, but may fail in unexpected edge cases.
				// 
				//  - Simple case: if `path` starts with `relativeTo`, then we can strip `path` 
				// off the `relativeTo` part and we're done.
				//
				//         util.makeRelativePath('abc/def/', 'abc') -> 'def'
				//
				//  - Harder case: `path` starts with some substring of `relativeTo`.  We want to remove this substring and then add `../` for each remaining segment of `relativeTo`.
				//
				//         util.makeRelativePath('abc/def/', 'abc/hij') -> '../def'
				//
				makeRelativePath: function(path, relativeTo) {
					var len = relativeTo.length;
					if (path.substring(0, len) == relativeTo) {
						/* Note: we're casting a boolean to an int by adding len to it */
						return path.slice((path.charAt(len) == '/') + len);
					}
				
					var sA = util.removeEndSlash(path).split('/'),
						sB = util.removeEndSlash(relativeTo).split('/'),
						i = 0;
				
					/* Count how many segments match. */
					while(sA[i] == sB[i]) { ++i; }
				
					if (i) {
						/* If at least some segments matched, remove them.  The result is our new path. */
						path = sA.slice(i).join('/');
					
						/* Prepend `../` for each segment remaining in `relativeTo`. */
						for (var j = sB.length - i; j > 0; --j) { path = '../' + path; }
					}
				
					return path;
				},
			
				// `buildPath` accepts an arbitrary number of string arguments to concatenate into a path.
				//     util.buildPath('a', 'b', 'c/', 'd/') -> 'a/b/c/d/'
				buildPath: function() {
					return util.resolveRelativePath(Array.prototype.join.call(arguments, '/'));
				},
			
				// `resolveRelativePath` removes relative path indicators.  For example:
				//     util.resolveRelativePath('a/../b') -> b
				resolveRelativePath: function(path) {
					/* If the path starts with a protocol, store it and remove it (add it
					   back later) so we don't accidently modify it. */
					var protocol = path.match(/^(\w+:\/\/)(.*)$/);
					if (protocol) { path = protocol[2]; }
				
					/* Remove multiple slashes and trivial dots (`/./ -> /`). */
					path = path.replace(/\/+/g, '/').replace(/\/\.\//g, '/');
				
					/* Loop to collapse instances of `../` in the path by matching a previous
					   path segment.  Essentially, we find substrings of the form `/abc/../`
					   where abc is not `.` or `..` and replace the substrings with `/`.
					   We loop until the string no longer changes since after collapsing all
					   possible instances once, we may have created more instances that can
					   be collapsed.
					*/
					var o;
					while((o = path) != (path = path.replace(/(^|\/)(?!\.?\.\/)([^\/]+)\/\.\.\//g, '$1'))) {}
					/* Don't forget to prepend any protocol we might have removed earlier. */
					return protocol ? protocol[1] + path : path;
				},
			
				resolveRelativeModule: function(modulePath, directory) {
					var result = [],
						parts = modulePath.split('.'),
						len = parts.length,
						relative = (len > 1 && !parts[0]),
						i = relative ? 0 : -1;
				
					while(++i < len) { result.push(parts[i] ? parts[i] : '..'); }
					return util.buildPath(relative ? directory : '', result.join('/'));
				},
				resolveModulePath: function(modulePath, directory) {
					// resolve relative paths
					if(modulePath.charAt(0) == '.') {
						return [makeModuleDef(util.resolveRelativeModule(modulePath, directory))];
					}
				
					// resolve absolute paths with respect to jsio packages/
					var pathSegments = modulePath.split('.'),
						baseMod = pathSegments[0],
						pathString = pathSegments.join('/');
				
					if (jsio.path.cache.hasOwnProperty(baseMod)) {
						return [makeModuleDef(util.buildPath(jsio.path.cache[baseMod], pathString))];
					}
				
					var out = [],
						paths = jsio.path.get(),
						len = paths.length;
					for (var i = 0; i < len; ++i) {
						out.push(makeModuleDef(util.buildPath(paths[i], pathString), baseMod, paths[i]));
					}
					return out;
				},
				splitPath: function(path) {
					var i = path.lastIndexOf('/') + 1;
					return {
						path: path,
						directory: path.substring(0, i),
						filename: path.substring(i)
					};
				}
			};
	
		var jsio = util.bind(this, importer, null, null, null);
		jsio.__util = util;
		jsio.__init__ = init;
		
		// explicitly use jsio.__srcCache to avoid obfuscation with closure compiler
		var sourceCache = jsio.__srcCache={"./base.js":{"path":"./base.js","directory":"./","filename":"base.js","src":"exports.log = jsio.__env.log;\nexports.GLOBAL = jsio.__env.global;\n\nvar SLICE = Array.prototype.slice;\n\nexports.isArray = function(obj) {\n\treturn Object.prototype.toString.call(obj) === '[object Array]';\n}\n\nexports.bind = function(context, method /*, VARGS*/) {\n\tif(arguments.length > 2) {\n\t\tvar args = SLICE.call(arguments, 2);\n\t\treturn typeof method == 'string'\n\t\t\t? function __bound() {\n\t\t\t\tif (context[method]) {\n\t\t\t\t\treturn context[method].apply(context, args.concat(SLICE.call(arguments, 0)));\n\t\t\t\t} else {\n\t\t\t\t\tthrow logger.error('No method:', method, 'for context', context);\n\t\t\t\t}\n\t\t\t}\n\t\t\t: function __bound() { return method.apply(context, args.concat(SLICE.call(arguments, 0))); }\n\t} else {\n\t\treturn typeof method == 'string'\n\t\t\t? function __bound() {\n\t\t\t\tif (context[method]) {\n\t\t\t\t\treturn context[method].apply(context, arguments);\n\t\t\t\t} else {\n\t\t\t\t\tthrow logger.error('No method:', method, 'for context', context);\n\t\t\t\t}\n\t\t\t}\n\t\t\t: function __bound() { return method.apply(context, arguments); }\n\t}\n}\n\nexports.Class = function(parent, proto) {\n\tif (typeof parent == 'string') {\n\t\tvar name = arguments[0],\n\t\t\tparent = arguments[1],\n\t\t\tproto = arguments[2],\n\t\t\tlogger = exports.logging.get(name);\n\t}\n\t\n\tif (!parent) { throw new Error('parent or prototype not provided'); }\n\tif (!proto) { proto = parent; parent = null; }\n\telse if (exports.isArray(parent)) { // multiple inheritance, use at your own risk =)\n\t\tproto.prototype = {};\n\t\tfor(var i = 0, p; p = parent[i]; ++i) {\n\t\t\tif (p == Error && ErrorParentClass) { p = ErrorParentClass; }\n\t\t\tfor (var item in p.prototype) {\n\t\t\t\tif (!(item in proto.prototype)) {\n\t\t\t\t\tproto.prototype[item] = p.prototype[item];\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t\tparent = parent[0]; \n\t} else {\n\t\tif (parent == Error && ErrorParentClass) { parent = ErrorParentClass; }\n\t\tproto.prototype = parent.prototype;\n\t}\n\t\n\tvar cls = function() { if (this.init) { return this.init.apply(this, arguments); }},\n\t\tsupr = parent ? function(context, method, args) {\n\t\t\tvar f = parent.prototype[method];\n\t\t\tif (!f) { throw new Error('method ' + method + ' does not exist'); }\n\t\t\treturn f.apply(context, args || []);\n\t\t} : null;\n\t\n\tcls.prototype = new proto(logger || supr, logger && supr);\n\tcls.prototype.constructor = cls;\n\tcls.prototype.__parentClass__ = parent;\n\tif (name) { cls.prototype.__class__ = name; }\n\treturn cls;\n}\n\nvar ErrorParentClass = exports.Class(Error, function() {\n\tthis.init = function() {\n\t\tvar err = Error.prototype.constructor.apply(this, arguments);\n\t\tfor (var prop in err) {\n\t\t\tif (err.hasOwnProperty(prop)) {\n\t\t\t\tthis[prop] = err[prop];\n\t\t\t}\n\t\t}\n\t}\n});\n\nexports.Class.defaults = \nexports.merge = function(base, extra) {\n\tbase = base || {};\n\t\n\tfor (var i = 1, len = arguments.length; i < len; ++i) {\n\t\tvar copyFrom = arguments[i];\n\t\tfor (var key in copyFrom) {\n\t\t\tif (copyFrom.hasOwnProperty(key) && !base.hasOwnProperty(key)) {\n\t\t\t\tbase[key] = copyFrom[key];\n\t\t\t}\n\t\t}\n\t}\n\t\n\treturn base;\n}\n\nexports.delay = function(orig, timeout) {\n\tvar _timer = null;\n\tvar ctx, args;\n\tvar f = function() { orig.apply(ctx, arguments); }\n\treturn function() {\n\t\tctx = this;\n\t\targs = arguments;\n\t\tif (_timer) { clearTimeout(_timer); }\n\t\t_timer = setTimeout(f, timeout || 0);\n\t}\n}\n\nexports.Class.ctor = function(proto, supr, defaults, post) {\n\tif (!supr) {\n\t\tsupr = function(ctx, method, args) {\n\t\t\tctx._opts = args[0];\n\t\t}\n\t}\n\n\tif (post) {\n\t\tproto.init = function(opts) {\n\t\t\tsupr(this, 'init', [opts = exports.merge(opts, defaults)]);\n\t\t\tpost.apply(this, [opts].concat(SLICE.call(arguments, 1)));\n\t\t}\n\t} else {\n\t\tproto.init = function(opts) {\n\t\t\tsupr(this, 'init', [exports.merge(opts, defaults)]);\n\t\t}\n\t}\n}\n\n// keep logging local variables out of other closures in this file!\nexports.logging = (function() {\n\t\n\t// logging namespace, this is what is exported\n\tvar logging = {\n\t\t\tDEBUG: 1,\n\t\t\tLOG: 2,\n\t\t\tINFO: 3,\n\t\t\tWARN: 4,\n\t\t\tERROR: 5\n\t\t},\n\t\tloggers = {}, // effectively globals - all loggers and a global production state\n\t\tproduction = false;\n\tvar gPrefix = '';\n\tlogging.setPrefix = function(prefix) { gPrefix = prefix + ' '; }\n\tlogging.setProduction = function(prod) { production = !!prod; }\n\tlogging.get = function(name) {\n\t\treturn loggers.hasOwnProperty(name) ? loggers[name]\n\t\t\t: (loggers[name] = new Logger(name));\n\t}\n\tlogging.set = function(name, _logger) {\n\t\tloggers[name] = _logger;\n\t}\n\t\n\tlogging.getAll = function() { return loggers; }\n\n\tlogging.__create = function(pkg, ctx) { ctx.logger = logging.get(pkg); }\n\t\n\tvar Logger = exports.Class(function() {\n\t\tthis.init = function(name, level) {\n\t\t\tthis._name = name;\n\t\t\tthis._level = level || logging.LOG;\n\t\t}\n\t\t\n\t\tthis.setLevel = function(level) { this._level = level; }\n\t\n\t\tfunction makeLogFunction(level, type) {\n\t\t\treturn function() {\n\t\t\t\tif (!production && level >= this._level) {\n\t\t\t\t\tvar prefix = type + ' ' + gPrefix + this._name,\n\t\t\t\t\t\tlistener = this._listener || exports.log;\n\t\t\t\t\t\n\t\t\t\t\treturn listener && listener.apply(this._listener, [prefix].concat(SLICE.call(arguments)));\n\t\t\t\t}\n\t\t\t\treturn arguments[0];\n\t\t\t}\n\t\t}\n\t\n\t\tthis.setListener = function(listener) { this._listener = listener; }\n\t\tthis.debug = makeLogFunction(logging.DEBUG, \"DEBUG\");\n\t\tthis.log = makeLogFunction(logging.LOG, \"LOG\");\n\t\tthis.info = makeLogFunction(logging.INFO, \"INFO\");\n\t\tthis.warn = makeLogFunction(logging.WARN, \"WARN\");\n\t\tthis.error = makeLogFunction(logging.ERROR, \"ERROR\");\n\t});\n\n\treturn logging;\n})();\n\nvar logger = exports.logging.get('jsiocore');\n","friendlyPath":"base"},"./Orbited.js":{"path":"./../Orbited.js","directory":"./../","filename":"Orbited.js","src":"jsio('from net.protocols.mspp import MSPPStream, MSPPProtocol');\njsio('import std.utf8')\n\nexports.logging = logging;\nexports.utf8 = std.utf8\n// autodetect host + port!!!\nexports.settings = { 'host': 'www.xinwaihui.com', 'port': '80', 'path': '/csp'};\n\nvar multiplexer = null;\nexports.TCPSocket = Class(MSPPStream, function() {\n    this.init = function() {\n        this.setEncoding('plain');\n        if (multiplexer == null || ('url' in multiplexer)==false) {\n            multiplexer = new MSPPProtocol();\n                multiplexer.setTransport('csp', {\"url\": \"http://\" + exports.settings.host + \":\" + exports.settings.port + exports.settings.path,\"preferredTransport\":\"xhr\"});\n        }\n        this.setMultiplexer(multiplexer);\n    }\n});\n","friendlyPath":"..Orbited"},"./net/protocols/mspp.js":{"path":"./net/protocols/mspp.js","directory":"./net/protocols/","filename":"mspp.js","baseMod":"net","basePath":"./","src":"jsio('import net');\njsio('from net.protocols.buffered import BufferedProtocol');\njsio('import std.utf8 as utf8');\n\n/*\nworks like this:\nOPEN\nupstream:\nlength_after_colon:id,0host,port\n\ndownstream:\nlength_after_colon:id,0\n-----\nCLOSE\nupstream:\nlength_after_colon:id,1\n\ndownstream:\nlength_after_colon:id,1errcode\n-----\nDATA\nupstream/downstream:\nlength_after_colon:id,2datadatadata\n*/\n\nvar loggers = {};\nloggers.stream = logging.get('MSPPStream');\nloggers.protocol = logging.get('MSPPProtocol');\n\nvar frames = {\n\t'OPEN':  0,\n\t'CLOSE': 1,\n\t'DATA':  2\n};\n\nexports.MSPPStream = Class(function() {\n\tthis.setMultiplexer = function(multiplexer) {\n\t\tloggers.stream.debug('setMultiplexer: '+multiplexer);\n\t\tthis.multiplexer = multiplexer;\n\t}\n\n\tthis.setEncoding = function(encoding) {\n\t\tloggers.stream.debug('setEncoding: '+encoding);\n\t\tthis.encoding = encoding;\n\t}\n\n\tthis.open = function(host, port, isBinary) {\n\t\tif (isBinary)\n\t\t\tthis.encoding = 'utf8';\n\t\tthis.id = this.multiplexer.openStream(this, host, port);\n\t\tloggers.stream.debug('open '+this.id+\": \"+host+\" \"+port+\" \"+isBinary);\n\t}\n\n\tthis.close = function() {\n\t\tloggers.stream.debug('close '+this.id);\n\t\tthis.multiplexer.close(this.id);\n\t}\n\n\tthis.send = function(data, encoding) {\n\t\tloggers.stream.debug('send '+this.id+\": \"+data+\" \"+encoding);\n\t\tif ((encoding || this.encoding) == 'utf8')\n\t\t\tdata = utf8.encode(data);\n\t\tthis.multiplexer.writeToStream(this.id, data);\n\t}\n\n\tthis._onreadraw = function(data) {\n\t\tif (this.encoding == 'utf8') {\n\t\t\tvar raw = utf8.decode(data);\n\t\t\tvar length = raw[1];\n\t\t\t// TODO: actually buffer this stuff properly\n\t\t\tif (length != data.length) {\n\t\t\t\tthrow new Error(\"Incomplete utf8 codepoint\");\n\t\t\t}\n\t\t\tdata = raw[0]\n\t\t}\n\t\tloggers.stream.debug('_onreadraw '+data);\n\t\tthis.onread(data);\n\t}\n\n\tthis.onopen = function() {}\n\tthis.onclose = function(err) {}\n\tthis.onread = function(data) {}\n});\n\nvar state = {};\nstate.closed = 0;\nstate.connecting = 1;\nstate.consuming = 2;\n\nexports.MSPPProtocol = Class(BufferedProtocol, function(supr) {\n\tthis.init = function() {\n\t\tloggers.protocol.debug('new MSPPProtocol');\n\t\tsupr(this, 'init', []);\n\t\tthis.state = state.closed;\n\t\tthis.transportType = null;\n\t\tthis.transportOptions = null;\n\t\tthis.currentId = 0;\n\t\tthis.streams = {};\n\t\tthis.writeBuffer = [];\n\t}\n\n\tthis.setTransport = function(transportType, transportOptions) {\n\t\tthis.transportType = transportType;\n\t\tthis.transportOptions = transportOptions;\n\t}\n\n\tthis.connectionMade = function(isReconnect) {\n\t\tloggers.protocol.debug('connectionMade');\n\t\tthis.state = state.consuming;\n\t\tfor (var i = 0; i < this.writeBuffer.length; i++)\n\t\t\tthis._write(this.writeBuffer[i]);\n\t\twriteBuffer = [];\n\t}\n\n\tthis.connectionLost = function(reason) {\n\t\tloggers.protocol.debug('closed: '+reason);\n\t\tthis.state = state.closed;\n\t\tfor (var stream in this.streams)\n\t\t\tthis.streams[stream].onclose(reason);\n\t}\n\n\tthis.openStream = function(stream, host, port) {\n\t\tif (this.state == state.closed) {\n\t\t\tthis.state = state.connecting;\n\t\t\tnet.connect(this, this.transportType, this.transportOptions);\n\t\t}\n\t\tvar id = ++this.currentId;\n\t\tthis.streams[id] = stream;\n\t\tthis._write([id, frames.OPEN, host+\",\"+port]);\n\t\treturn id;\n\t}\n\n\tthis.closeStream = function(id) {\n\t\tthis._write([id, frames.CLOSE, \"\"]);\n\t}\n\n\tthis.writeToStream = function(id, data) {\n\t\tthis._write([id, frames.DATA, data]);\n\t}\n\n\tthis.bufferUpdated = function() {\n\t\tloggers.protocol.debug(\"bufferUpdated. state: \"+this.state+\". buffer: \"+this.buffer._rawBuffer);\n\t\tif (this.state != state.consuming)\n\t\t\tthrow new Error(\"buffer update in invalid MSPP state: \"+this.state);\n\t\tif (! this.buffer.hasDelimiter(':'))\n\t\t\treturn;\n\t\tvar lStr = this.buffer.peekToDelimiter(':');\n\t\tvar len = parseInt(lStr);\n\t\tif (! this.buffer.hasBytes(len + lStr.length + 1))\n\t\t\treturn;\n\t\tthis.buffer.consumeThroughDelimiter(':');\n\t\tvar streamId = this.buffer.consumeToDelimiter(',');\n\t\tthis.buffer.consumeBytes(1);\n\t\tvar frameType = parseInt(this.buffer.consumeBytes(1));\n\t\tlen -= (streamId.length + 2);\n\t\tstreamId = parseInt(streamId);\n\t\tvar data = this.buffer.consumeBytes(len);\n\t\tswitch(frameType) {\n\t\t\tcase frames.OPEN:\n\t\t\t\tthis.streams[streamId].onopen();\n\t\t\t\tbreak;\n\t\t\tcase frames.CLOSE:\n\t\t\t\tthis.streams[streamId].onclose(data);\n\t\t\t\tbreak;\n\t\t\tcase frames.DATA:\n\t\t\t\tthis.streams[streamId]._onreadraw(data);\n\t\t\t\tbreak;\n\t\t\tdefault:\n\t\t\t\tthrow new Error('invalid MSPP data type!');\n\t\t}\n\t}\n\n\tthis._write = function(data) {\n\t\tif (this.state != state.consuming) {\n\t\t\tloggers.protocol.debug(\"buffering write: \"+data);\n\t\t\tthis.writeBuffer.push(data);\n\t\t\treturn;\n\t\t}\n\t\tvar s = data[0] + \",\" + data[1] + data[2];\n\t\ts = s.length + \":\" + s;\n\t\tloggers.protocol.debug('write: '+s);\n\t\tthis.transport.write(s);\n\t}\n});\n","friendlyPath":"net.protocols.mspp"},"./net.js":{"path":"./net.js","directory":"./","filename":"net.js","src":"jsio('import net.env');\njsio('import std.JSON as JSON');\n\nJSON.createGlobal(); // create the global JSON object if it doesn't already exist\n\nexports.listen = function(server, transportName, opts) {\n\tif (!transportName) {\n\t\tthrow logger.error('No transport provided for net.listen');\n\t}\n\t\n\tvar ctor = typeof transportName == 'string' ? net.env.getListener(transportName) : transportName,\n\t\tlistener = new ctor(server, opts);\n\t\n\tlistener.listen();\n\treturn listener;\n}\n\nexports.connect = function(protocolInstance, transportName, opts) {\n\tvar ctor = typeof transportName == 'string' ? net.env.getConnector(transportName) : transportName,\n\t\tconnector = new ctor(protocolInstance, opts);\n\tconnector.connect();\n\treturn connector;\n}\n\nexports.quickServer = function(protocolClass) {\n\tjsio('import net.interfaces');\n\treturn new net.interfaces.Server(protocolClass);\n}\n","friendlyPath":"net"},"./net/env.js":{"path":"./net/env.js","directory":"./net/","filename":"env.js","src":"function getObj(objectName, transportName, envName) {\n\t\n\ttry {\n\t\tvar DYNAMIC_IMPORT_ENV = 'from .env.' + (envName || jsio.__env.name) + '.' + transportName + ' import ' + objectName + ' as result';\n\t\tjsio(DYNAMIC_IMPORT_ENV);\n\t} catch(e) {\n\t\tthrow logger.error('Invalid transport (', transportName, ') or environment (', envName, ')');\n\t}\n\treturn result;\n}\n\nexports.getListener = bind(this, getObj, 'Listener');\nexports.getConnector = bind(this, getObj, 'Connector');\n","friendlyPath":"net.env"},"./net/env/browser/csp.js":{"path":"./net/env/browser/csp.js","directory":"./net/env/browser/","filename":"csp.js","src":"jsio('import net.interfaces');\njsio('from net.csp.client import CometSession');\njsio('import std.utf8 as utf8');\n\nexports.Connector = Class(net.interfaces.Connector, function() {\n\tthis.connect = function() {\n\t\tthis._state = net.interfaces.STATE.CONNECTING;\n\t\t\n\t\tvar conn = new CometSession();\n\t\tconn.onconnect = bind(this, 'cometSessionOnConnect', conn);\n\t\tconn.ondisconnect = bind(this, 'onDisconnect');\n\t\t\n\t\tlogger.debug('opening the connection');\n\t\tif (!this._opts.encoding) { this._opts.encoding = 'plain'; }\n\t\tconn.connect(this._opts.url, this._opts);//{encoding: 'plain'});\n\t}\n\t\n\tthis.cometSessionOnConnect = function(conn) {\n\t\tlogger.debug('conn has opened');\n\t\tthis.onConnect(new Transport(conn));\n\t}\n});\n\nvar Transport = Class(net.interfaces.Transport, function() {\n\tthis.init = function(conn) {\n\t\tthis._conn = conn;\n\t}\n\t\n\tthis.makeConnection = function(protocol) {\n\t\tthis._conn.onread = bind(protocol, 'dataReceived');\n\t}\n\t\n\tthis.write = function(data) {\n\t\tthis._conn.write(data);\n\t}\n\t\n\tthis.loseConnection = function(protocol) {\n\t\tthis._conn.close();\n\t}\n});\n","friendlyPath":"net.env.browser.csp"},"./net/interfaces.js":{"path":"./net/interfaces.js","directory":"./net/","filename":"interfaces.js","src":"// Sort of like a twisted protocol\njsio('import net');\njsio('import lib.Enum as Enum');\n\nvar ctx = jsio.__env.global;\n\nexports.Protocol = Class(function() {\n\tthis.connectionMade = function(isReconnect) {}\n\tthis.dataReceived = function(data) {}\n\tthis.connectionLost = function(reason) {}\n\t\n\tthis._connectionMade = function() {\n\t\tthis._isConnected = true;\n\t\tthis.connectionMade.apply(this, arguments);\n\t}\n\n\tthis._connectionLost = function() {\n\t\tthis._isConnected = true;\n\t\tthis.connectionLost.apply(this, arguments);\n\t}\n\n\tthis._isConnected = false;\n\tthis.isConnected = function() {\n\t\treturn !!this._isConnected;\n\t}\n\t\n\t\n});\n\nexports.Client = Class(function() {\n\tthis.init = function(protocol) {\n\t\tthis._protocol = protocol;\n\t}\n\t\n\tthis.connect = function(transportName, opts) {\n\t\tthis._remote = new this._protocol();\n\t\tthis._remote._client = this;\n\t\tnet.connect(this._remote, transportName, opts);\n\t}\n});\n\n// Sort of like a twisted factory\nexports.Server = Class(function() {\n\tthis.init = function(protocolClass) {\n\t\tthis._protocolClass = protocolClass;\n\t}\n\n\tthis.buildProtocol = function() {\n\t\treturn new this._protocolClass();\n\t}\n\t\n\tthis.listen = function(how, port) {\n\t\treturn net.listen(this, how, port);\n\t}\n});\n\nexports.Transport = Class(function() {\n\tthis._encoding = 'plain'\n\tthis.write = function(data, encoding) {\n\t\tthrow new Error(\"Not implemented\");\n\t}\n\tthis.getPeer = function() {\n\t\tthrow new Error(\"Not implemented\");\n\t}\n\tthis.setEncoding = function(encoding) {\n\t\tthis._encoding = encoding;\n\t}\n\tthis.getEncoding = function() {\n\t\treturn this._encoding;\n\t}\n});\n\nexports.Listener = Class(function() {\n\tthis.init = function(server, opts) {\n\t\tthis._server = server;\n\t\tthis._opts = opts || {};\n\t}\n\t\n\tthis.onConnect = function(transport) {\n//\t\ttry {\n\t\t\tvar p = this._server.buildProtocol();\n\t\t\tp.transport = transport;\n\t\t\tp.server = this._server;\n\t\t\ttransport.protocol = p;\n\t\t\ttransport.makeConnection(p);\n\t\t\tp._connectionMade();\n//\t\t} catch(e) {\n//\t\t\tlogger.error(e);\n//\t\t}\n\t}\n\t\n\tthis.listen = function() { throw new Error('Abstract class'); }\n\tthis.stop = function() {}\n});\n\nexports.STATE = Enum('INITIAL', 'DISCONNECTED', 'CONNECTING', 'CONNECTED');\nexports.Connector = Class(function() {\n\tthis.init = function(protocol, opts) {\n\t\tthis._protocol = protocol;\n\t\tthis._opts = opts;\n\t\tthis._state = exports.STATE.INITIAL;\n\t}\n\t\n\tthis.getState = function() { return this._state; }\n\t\n\tthis.onConnect = function(transport) {\n\t\tthis._state = exports.STATE.CONNECTED;\n\n\t\ttransport.makeConnection(this._protocol);\n\t\tthis._protocol.transport = transport;\n\t\ttry {\n\t\t\tthis._protocol._connectionMade();\n\t\t} catch(e) {\n\t\t\tthrow logger.error(e);\n\t\t}\n\t}\n\t\n\tthis.onDisconnect = function(err) {\n\t\tvar wasConnected = this._state == exports.STATE.CONNECTED;\n\t\tthis._state = exports.STATE.DISCONNECTED;\n\t\t\n\t\ttry {\n\t\t\tthis._protocol._connectionLost(err, wasConnected);\n\t\t} catch(e) {\n\t\t\tthrow logger.error(e);\n\t\t}\n\t}\n\t\n\tthis.getProtocol = function() { return this._protocol; }\n});\n","friendlyPath":"net.interfaces"},"./lib/Enum.js":{"path":"./lib/Enum.js","directory":"./lib/","filename":"Enum.js","baseMod":"lib","basePath":"./","src":"exports = function() {\n\tif (arguments.length == 1) {\n\t\tif (typeof arguments[0] == 'object') {\n\t\t\tvar obj = arguments[0];\n\t\t\tfor (var i in obj) {\n\t\t\t\tif (!(obj[i] in obj)) {\n\t\t\t\t\tobj[obj[i]] = i;\n\t\t\t\t}\n\t\t\t}\n\t\t\treturn obj;\n\t\t} else if (typeof arguments[0] != 'string') {\n\t\t\tkeys = arguments[0];\n\t\t}\n\t}\n\t\n\tif (!keys) { var keys = arguments; }\n\tvar obj = {};\n\tfor(var i = 0, len = keys.length; i < len; ++i) {\n\t\tif (keys[i]) {\n\t\t\tobj[keys[i]] = i + 1;\n\t\t}\n\t\tobj[i + 1] = keys[i];\n\t}\n\treturn obj;\n}","friendlyPath":"lib.Enum"},"./net/csp/client.js":{"path":"./net/csp/client.js","directory":"./net/csp/","filename":"client.js","src":"jsio('import std.base64 as base64');\njsio('import std.utf8 as utf8');\njsio('import std.uri as uri'); \njsio('import net.errors as errors');\njsio('import .transports');\njsio('import lib.Enum as Enum');\n\nvar READYSTATE = exports.READYSTATE = Enum({\n\tINITIAL: 0,\n\tCONNECTING: 1,\n\tCONNECTED: 2,\n\tDISCONNECTING: 3,\n\tDISCONNECTED:  4\n});\n\n\nexports.CometSession = Class(function(supr) {\n\tvar id = 0;\n\tvar kDefaultBackoff = 50;\n\tvar kDefaultTimeoutInterval = 45000;\n\tvar kDefaultHandshakeTimeout = 10000;\n\tthis.init = function() {\n\t\tthis._id = ++id;\n\t\tthis._url = null;\n\t\tthis.readyState = READYSTATE.INITIAL;\n\t\tthis._sessionKey = null;\n\t\tthis._transport = null;\n\t\tthis._options = null;\n\t\t\n\t\tthis._utf8ReadBuffer = \"\";\n\t\tthis._writeBuffer = \"\";\n\t\t\n\t\tthis._packetsInFlight = null;\n\t\tthis._lastEventId = null;\n\t\tthis._lastSentId = null;\n\t\t\n\t\tthis._handshakeLater = null;\n\t\tthis._handshakeBackoff = kDefaultBackoff;\n\t\tthis._handshakeRetryTimer = null;\n\t\tthis._handshakeTimeoutTimer = null;\n\n\t\tthis._timeoutTimer = null;\n\n\t\t\n\t\tthis._writeBackoff = kDefaultBackoff;\n\t\tthis._cometBackoff = kDefaultBackoff;\n\t\t\n\t\tthis._nullInBuffer = false;\n\t\tthis._nullInFlight= false;\n\t\tthis._nullSent = false;\n\t\tthis._nullReceived = false;\n\t}\n\t\n\t\n\tthis.setEncoding = function(encoding) {\n\t\tif (encoding == this._options.encoding) { \n\t\t\treturn; \n\t\t}\n\t\tif (encoding != 'utf8' && encoding != 'plain') {\n\t\t\tthrow new errors.InvalidEncodingError();\n\t\t}\n\t\tif (encoding == 'plain' && this._buffer) {\n\t\t\tvar buffer = this._utf8ReadBuffer;\n\t\t\tthis._utf8ReadBuffer = \"\";\n\t\t\tthis._doOnRead(buffer);\n\t\t}\n\t\tthis._options.encoding = encoding;\n\t}\n\n\n\tthis.connect = function(url, options) {\n\t\tthis._url = url.replace(/\\/$/,'');\n\t\tthis._options = options || {};\n\t\t\n\t\tthis._options.encoding = this._options.encoding || 'utf8';\n\t\tthis.setEncoding(this._options.encoding); // enforce encoding constraints\n\t\t\n\t\tthis._options.connectTimeout = this._options.connectTimeout || kDefaultHandshakeTimeout;\n\t\t\n\t\tvar transportClass = transports.chooseTransport(url, this._options);\n\t\tthis._transport = new transportClass();\n\t\t\n\t\tthis._transport.handshakeFailure = bind(this, this._handshakeFailure);\n\t\tthis._transport.handshakeSuccess = bind(this, this._handshakeSuccess);\n\t\t\n\t\tthis._transport.cometFailure = bind(this, this._cometFailure);\n\t\tthis._transport.cometSuccess = bind(this, this._cometSuccess);\n\t\t\n\t\tthis._transport.sendFailure = bind(this, this._writeFailure);\n\t\tthis._transport.sendSuccess = bind(this, this._writeSuccess);\n\t\tthis.readyState = READYSTATE.CONNECTING;\n\t\tthis._transport.handshake(this._url, this._options);\n\t\t\n\t\tthis._handshakeTimeoutTimer = setTimeout(bind(this, this._handshakeTimeout), \n\t\t\tthis._options.connectTimeout);\n\t}\n\n\tthis.write = function(data, encoding) {\n\t\tif (this.readyState != READYSTATE.CONNECTED) {\n\t\t\tthrow new errors.ReadyStateError();\n\t\t}\n\t\tencoding = encoding || this._options.encoding || 'utf8';\n\t\tif (encoding == 'utf8') {\n\t\t\tdata = utf8.encode(data);\n\t\t}\n\t\tthis._writeBuffer += data;\n\t\tthis._doWrite();\n\t}\n\t\n\t// Close due to protocol error\n\tthis._protocolError = function(msg) {\n\t\tlogger.debug('_protocolError', msg);\n\t\t// Immediately fire the onclose\n\t\t// send a null packet to the server\n\t\t// don't wait for a null packet back.\n\t\tthis.readyState = READYSTATE.DISCONNECTED;\n\t\tthis._doWrite(true);\n\t\tthis._doOnDisconnect(new errors.ServerProtocolError(msg));\n\t}\n\t\n\tthis._receivedNullPacket = function() {\n\t\tlogger.debug('_receivedNullPacket');\n\t\t// send a null packet back to the server\n\t\tthis._receivedNull = true;\n\t\t\n\t\t// send our own null packet back. (maybe)\n\t\tif (!(this._nullInFlight || this._nullInBuffer || this._nullSent)) {\n\t\t\tthis.readyState = READYSTATE.DISCONNECTING;\n\t\t\tthis._doWrite(true);\n\t\t}\n\t\telse {\n\t\t\tthis.readyState = READYSTATE.DISCONNECTED;\n\t\t}\n\t\t\n\t\t// fire an onclose\n\t\tthis._doOnDisconnect(new errors.ConnectionClosedCleanly());\n\n\t}\n\t\n\tthis._sentNullPacket = function() {\n\t\tlogger.debug('_sentNullPacket');\n\t\tthis._nullSent = true;\n\t\tif (this._nullSent && this._nullReceived) {\n\t\t\tthis.readyState = READYSTATE.DISCONNECTED;\n\t\t}\n\t}\n\t\n\t\n\t// User Calls close\n\tthis.close = function(err) {\n\t\tlogger.debug('close called', err, 'readyState', this.readyState);\n\n\t\t// \n\t\tswitch(this.readyState) {\n\t\t\tcase READYSTATE.CONNECTING:\n\t\t\t\tclearTimeout(this._handshakeRetryTimer);\n\t\t\t\tclearTimeout(this._handshakeTimeoutTimer);\n\t\t\t\tthis.readyState = READYSTATE.DISCONNECTED;\n\t\t\t\tthis._doOnDisconnect(err);\n\t\t\t\tbreak;\n\t\t\tcase READYSTATE.CONNECTED:\n\t\t\t\tthis.readyState = READYSTATE.DISCONNECTING;\n\t\t\t\tthis._doWrite(true);\n\t\t\t\tclearTimeout(this._timeoutTimer);\n\t\t\t\tbreak;\n\t\t\tcase READYSTATE.DISCONNECTED:\n\t\t\t\tthrow new errors.ReadyStateError(\"Session is already disconnected\");\n\t\t\t\tbreak;\n\t\t}\n\t\t\n\t\tthis._sessionKey = null;\n\t\tthis._opened = false; // what is this used for???\n\t\tthis.readyState = READYSTATE.DISCONNECTED;\n\t\t\n\t\tthis._doOnDisconnect(err);\n\t}\n\t\n\tthis._handshakeTimeout = function() {\n\t\tlogger.debug('handshake timeout');\n\t\tthis._handshakeTimeoutTimer = null;\n\t\tclearTimeout(this._handshakeRetryTimer);\n\t\tif (this.readyState == READYSTATE.CONNECTING) {\n\t\t\tthis.readyState = READYSTATE.DISCONNECTED;\n\t\t}\n\t\t\n\t\tthis._doOnDisconnect(new errors.ServerUnreachable());\n\t}\n\t\n\tthis._handshakeSuccess = function(data) {\n\t\tlogger.debug('handshake success', data);\n\t\tif (this.readyState != READYSTATE.CONNECTING) { \n\t\t\tlogger.debug('received handshake success in invalid readyState:', this.readyState);\n\t\t\treturn; \n\t\t}\n\t\tclearTimeout(this._handshakeTimeoutTimer);\n\t\tthis._handshakeTimeoutTimer = null;\n\t\tthis._sessionKey = data.response.session;\n\t\tthis._opened = true;\n\t\tthis.readyState = READYSTATE.CONNECTED;\n\t\tthis._doOnConnect();\n\t\tthis._doConnectComet();\n\t}\n\t\n\tthis._handshakeFailure = function(data) {\n\t\tlogger.debug('handshake failure', data);\n\t\tif (this.readyState != READYSTATE.CONNECTING) { return; }\n\t\tif (data.status == 404) {\n\t\t\tclearTimeout(this._handshakeTimeoutTimer);\n\t\t\treturn this._doOnDisconnect(new errors.ServerUnreachable());\n\t\t}\n\t\t\n\t\tlogger.debug('trying again in ', this._handshakeBackoff);\n\t\tthis._handshakeRetryTimer = setTimeout(bind(this, function() {\n\t\t\tthis._handshakeRetryTimer = null;\n\t\t\tthis._transport.handshake(this._url, this._options);\n\t\t}), this._handshakeBackoff);\n\t\t\n\t\tthis._handshakeBackoff *= 2;\n\t}\n\t\n\tthis._writeSuccess = function() {\n\t\tif (this.readyState != READYSTATE.CONNECTED && this.readyState != READYSTATE.DISCONNECTING) {\n\t\t\treturn;\n\t\t}\n\t\tif (this._nullInFlight) {\n\t\t\treturn this._sentNullPacket();\n\t\t}\n\t\tthis._resetTimeoutTimer();\n\t\tthis.writeBackoff = kDefaultBackoff;\n\t\tthis._packetsInFlight = null;\n\t\tif (this._writeBuffer || this._nullInBuffer) {\n\t\t\tthis._doWrite(this._nullInBuffer);\n\t\t}\n\t}\n\t\n\tthis._writeFailure = function() {\n\t\tif (this.readyState != READYSTATE.CONNECTED && this.READYSTATE != READYSTATE.DISCONNECTING) { return; }\n\t\tthis._writeTimer = setTimeout(bind(this, function() {\n\t\t\tthis._writeTimer = null;\n\t\t\tthis.__doWrite(this._nullInBuffer);\n\t\t}), this._writeBackoff);\n\t\tthis._writeBackoff *= 2;\n\t}\t\n\n\tthis._doWrite = function(sendNull) {\n\t\tif (this._packetsInFlight) {\n\t\t\tif (sendNull) {\n\t\t\t\tthis._nullInBuffer = true;\n\t\t\t\treturn; \n\t\t\t}\n\t\t\treturn;\n\t\t}\n\t\tthis.__doWrite(sendNull);\n\t}\n\t\n\tthis.__doWrite = function(sendNull) {\n\t\tlogger.debug('_writeBuffer:', this._writeBuffer);\n\t\tif (!this._packetsInFlight && this._writeBuffer) {\n\t\t\tthis._packetsInFlight = [this._transport.encodePacket(++this._lastSentId, this._writeBuffer, this._options)];\n\t\t\tthis._writeBuffer = \"\";\n\t\t}\n\t\tif (sendNull && !this._writeBuffer) {\n\t\t\tif (!this._packetsInFlight) {\n\t\t\t\tthis._packetsInFlight = [];\n\t\t\t}\n\t\t\tthis._packetsInFlight.push([++this._lastSentId, 0, null]);\n\t\t\tthis._nullInFlight = true;\n\t\t}\n\t\tif (!this._packetsInFlight) {\n\t\t\tlogger.debug(\"no packets to send\");\n\t\t\treturn;\n\t\t}\n\t\tlogger.debug('sending packets:', JSON.stringify(this._packetsInFlight));\n\t\tthis._transport.send(this._url, this._sessionKey, this._lastEventId || 0, JSON.stringify(this._packetsInFlight), this._options);\n\t}\n\t\n\tthis._doConnectComet = function() {\n\t\tlogger.debug('_doConnectComet');\n//\t\treturn;\n\t\tthis._transport.comet(this._url, this._sessionKey, this._lastEventId || 0, this._options);\n\t}\n\n\tthis._cometFailure = function(data) {\n\t\tif (this.readyState != READYSTATE.CONNECTED) { return; }\n\t\tif (data.status == 404 && data.response == 'Session not found') {\n\t\t\treturn this.close(new errors.ExpiredSession(data));\n\t\t}\n\t\t\n\t\tthis._cometTimer = setTimeout(bind(this, '_doConnectComet'), this._cometBackoff);\n\t\tthis._cometBackoff *= 2;\n\t}\n\t\n\tthis._cometSuccess = function(data) {\n\t\tif (this.readyState != READYSTATE.CONNECTED && this.readyState != READYSTATE.DISCONNECTING) { return; }\n\t\tlogger.debug('comet Success:', data);\n\t\tthis._cometBackoff = kDefaultBackoff;\n\t\tthis._resetTimeoutTimer();\n\t\t\n\t\tvar response = data.response;\n\t\tfor (var i = 0, packet; (packet = response[i]) || i < response.length; i++) {\n\t\t\tlogger.debug('process packet:', packet);\n\t\t\tif (packet === null) {\n\t\t\t\treturn this.close(new errors.ServerProtocolError(data));\n\t\t\t}\n\t\t\tlogger.debug('process packet', packet);\n\t\t\tvar ackId = packet[0];\n\t\t\tvar encoding = packet[1];\n\t\t\tvar data = packet[2];\n\t\t\tif (typeof(this._lastEventId) == 'number' && ackId <= this._lastEventId) {\n\t\t\t\tcontinue;\n\t\t\t}\n\t\t\tif (typeof(this._lastEventId) == 'number' && ackId != this._lastEventId+1) {\n\t\t\t\treturn this._protocolError(\"Ack id too high\");\n\t\t\t}\n\t\t\tthis._lastEventId = ackId;\n\t\t\tif (data == null) {\n\t\t\t\treturn this._receivedNullPacket();\n\t\t\t}\n\t\t\tif (encoding == 1) { // base64 encoding\n\t\t\t\ttry {\n\t\t\t\t\tlogger.debug('before base64 decode:', data);\n\t\t\t\t\tdata = base64.decode(data);\n\t\t\t\t\tlogger.debug('after base64 decode:', data);\n\t\t\t\t} catch(e) {\n\t\t\t\t\treturn this._protocolError(\"Unable to decode base64 payload\");\n\t\t\t\t}\n\t\t\t}\n\t\t\tif (this._options.encoding == 'utf8') {\n\t\t\t\t// TODO: need an incremental utf8 decoder for this stuff.\n\t\t\t\tthis._utf8ReadBuffer += data;\n\t\t\t\tlogger.debug('before utf8 decode, _utf8ReadBuffer:', this._utf8ReadBuffer);\n\t\t\t\tvar result = utf8.decode(this._utf8ReadBuffer);\n\t\t\t\tdata = result[0];\n\t\t\t\tthis._utf8ReadBuffer = this._utf8ReadBuffer.slice(result[1]);\n\t\t\t\tlogger.debug('after utf8 decode, _utf8ReadBuffer:', this._utf8ReadBuffer, 'data:', data );\n\t\t\t}\n\t\t\tlogger.debug('dispatching data:', data);\n\n\t\t\t// TODO: possibly catch this error in production? but not in dev\n\t\t\tthis._doOnRead(data);\n\t\t}\n\t\t\n\t\tif (this.readyState != READYSTATE.CONNECTED && this.readyState != READYSTATE.DISCONNECTING) { return; }\n\t\t\n\t\t// reconnect comet last, after we process all of the packet ids\n\t\tthis._doConnectComet();\n\t\t\n\t}\n\n\tthis._doOnRead = function(data) {\n\t\tif (typeof(this.onread) == 'function') {\n\t\t\tlogger.debug('call onread function', data);\n\t\t\tthis.onread(data);\n\t\t}\n\t\telse {\n\t\t\tlogger.debug('skipping onread callback (function missing)');\n\t\t}\n\t}\n\t\n\tthis._doOnDisconnect = function(err) {\n\t\tif (typeof(this.ondisconnect) == 'function') {\n\t\t\tlogger.debug('call ondisconnect function', err);\n\t\t\tthis.ondisconnect(err);\n\t\t}\n\t\telse {\n\t\t\tlogger.debug('skipping ondisconnect callback (function missing)');\n\t\t}\n\t}\n\t\n\tthis._doOnConnect = function() {\n\t\tif (typeof(this.onconnect) == 'function') {\n\t\t\tlogger.debug('call onconnect function');\n\t\t\ttry {\n\t\t\t\tthis.onconnect();\n\t\t\t} catch(e) {\n\t\t\t\tlogger.debug('onconnect caused errror', e);\n\t\t\t\t// throw error later\n\t\t\t\tsetTimeout(function() { throw e }, 0);\n\t\t\t}\n\t\t}\n\t\telse {\n\t\t\tlogger.debug('skipping onconnect callback (function missing)');\n\t\t}\n\t}\n\n\tthis._resetTimeoutTimer = function() {\n\t\tclearTimeout(this._timeoutTimer);\n\t\tthis._timeoutTimer = setTimeout(bind(this, function() {\n\t\t\tlogger.debug('connection timeout expired');\n\t\t\tthis.close(new errors.ConnectionTimeout())\n\t\t}), this._getTimeoutInterval())\n\t}\n\t\n\tthis._getTimeoutInterval = function() {\n\t\treturn kDefaultTimeoutInterval;\n\t}\n\n});\n","friendlyPath":"net.csp.client"},"./std/base64.js":{"path":"./std/base64.js","directory":"./std/","filename":"base64.js","src":"/*\n\"URL-safe\" Base64 Codec, by Jacob Rus\n\nThis library happily strips off as many trailing '=' as are included in the\ninput to 'decode', and doesn't worry whether its length is an even multiple\nof 4. It does not include trailing '=' in its own output. It uses the\n'URL safe' base64 alphabet, where the last two characters are '-' and '_'.\n\n--------------------\n\nCopyright (c) 2009 Jacob Rus\n\nPermission is hereby granted, free of charge, to any person\nobtaining a copy of this software and associated documentation\nfiles (the \"Software\"), to deal in the Software without\nrestriction, including without limitation the rights to use,\ncopy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the\nSoftware is furnished to do so, subject to the following\nconditions:\n\nThe above copyright notice and this permission notice shall be\nincluded in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES\nOF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND\nNONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT\nHOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,\nWHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\nFROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR\nOTHER DEALINGS IN THE SOFTWARE.\n*/\n\nvar alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',\n\ttrailingPad = '=',\n\tpadChar = alphabet.charAt(alphabet.length - 1);\n\nvar decodeMap = {};\nfor (var i = 0, len = alphabet.length; i < len; i++) {\n\tdecodeMap[alphabet.charAt(i)] = i;\n}\n\n// use this regexp in the decode function to sniff out invalid characters.\nvar alphabet_inverse = new RegExp('[^' + alphabet.replace('-', '\\\\-') + ']');\n\nexports.Base64CodecError = Class(Error, function(supr) {\n\tthis.name = 'Base64CodecError';\n\t\n\tthis.init = function(message) {\n\t\tsupr(this, 'init', arguments);\n\t\tthis.message = message;\n\t}\n});\n\nvar assertOrBadInput = function (exp, message) {\n\tif (!exp) { throw new exports.Base64CodecError(message) };\n};\n\nexports.encode = function (bytes) {\n\tassertOrBadInput(!(/[^\\x00-\\xFF]/.test(bytes)), // disallow two-byte chars\n\t\t'Input contains out-of-range characters.');\n\tvar padding = '\\x00\\x00\\x00'.slice((bytes.length % 3) || 3);\n\tbytes += padding; // pad with null bytes\n\tvar out_array = [];\n\tfor (var i=0, n=bytes.length; i < n; i+=3) {\n\t\tvar newchars = (\n\t\t\t(bytes.charCodeAt(i)   << 020) +\n\t\t\t(bytes.charCodeAt(i+1) << 010) +\n\t\t\t(bytes.charCodeAt(i+2)));\n\t\tout_array.push(\n\t\t\talphabet.charAt((newchars >> 18) & 077),\n\t\t\talphabet.charAt((newchars >> 12) & 077),\n\t\t\talphabet.charAt((newchars >> 6)  & 077), \n\t\t\talphabet.charAt((newchars)\t   & 077));\t  \n\t};\n\t\n\tout_array.length -= padding.length;\n\treturn out_array.join('');\n};\n\nexports.decode = function (b64text) {\n\tlogger.debug('decode', b64text);\n\tb64text = b64text.replace(/\\s/g, ''); // kill whitespace\n\t\n\t// strip trailing pad characters from input; // XXX maybe some better way?\n\tvar i = b64text.length;\n\twhile (b64text.charAt(--i) === trailingPad) {};\n\tb64text = b64text.slice(0, i + 1);\n\t\n\tassertOrBadInput(!alphabet_inverse.test(b64text), 'Input contains out-of-range characters.');\n\t\n\tvar padLength = 4 - ((b64text.length % 4) || 4),\n\t\tpadding = Array(padLength + 1).join(padChar);\n\t\n\tb64text += padding; // pad with last letter of alphabet\n\t\n\tvar out_array = [],\n\t\tlength = i + padLength + 1; // length of b64text\n\t\n\tfor (var i = 0; i < length; i += 4) {\n\t\tnewchars = (\n\t\t\t(decodeMap[b64text.charAt(i)]   << 18) +\n\t\t\t(decodeMap[b64text.charAt(i+1)] << 12) +\n\t\t\t(decodeMap[b64text.charAt(i+2)] << 6)  +\n\t\t\t(decodeMap[b64text.charAt(i+3)]));\n\t\tout_array.push(\n\t\t\t(newchars >> 020) & 0xFF,\n\t\t\t(newchars >> 010) & 0xFF, \n\t\t\t(newchars)\t\t& 0xFF);\n\t};\n\t\n\tlength = (out_array.length -= padLength);\n\t\n\t// Safari fromCharCode can't be passed more than 65536 arguments at once\n\tvar result,\n\t\tMAX_CHUNK = 65536;\n\t\n\tif (length > MAX_CHUNK) {\n\t\tresult = [];\n\t\tvar i = 0, j = 0;\n\t\twhile (i < length) {\n\t\t\tresult[j++] = String.fromCharCode.apply(String, out_array.slice(i, i + MAX_CHUNK));\n\t\t\ti += MAX_CHUNK;\n\t\t}\n\t\tresult = result.join('');\n\t} else {\n\t\tresult = String.fromCharCode.apply(String, out_array);\n\t}\n\tlogger.debug('decoded', result);\n\treturn result;\n};\n","friendlyPath":"std.base64"},"./std/utf8.js":{"path":"./std/utf8.js","directory":"./std/","filename":"utf8.js","src":"/*\nFast incremental JavaScript UTF-8 encoder/decoder, by Jacob Rus.\n\nAPI for decode from Orbited: as far as I know, the first incremental\nJavaScript UTF-8 decoder.\n\nInspired by the observation by Johan Sundström published at:\nhttp://ecmanaut.blogspot.com/2006/07/encoding-decoding-utf8-in-javascript.html\n\nNote that this code throws an error for invalid UTF-8. Because it is so much\nfaster than previous implementations, the recommended way to do lenient\nparsing is to first try this decoder, and then fall back on a slower lenient\ndecoder if necessary for the particular use case.\n\n--------------------\n\nCopyright (c) 2009 Jacob Rus\n\nPermission is hereby granted, free of charge, to any person\nobtaining a copy of this software and associated documentation\nfiles (the \"Software\"), to deal in the Software without\nrestriction, including without limitation the rights to use,\ncopy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the\nSoftware is furnished to do so, subject to the following\nconditions:\n\nThe above copyright notice and this permission notice shall be\nincluded in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES\nOF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND\nNONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT\nHOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,\nWHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\nFROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR\nOTHER DEALINGS IN THE SOFTWARE.\n*/\n//var utf8 = this.utf8 = exports;\n\nexports.UnicodeCodecError = function (message) { \n\tthis.message = message; \n};\n\nvar UnicodeCodecError = exports.UnicodeCodecError;\n\nUnicodeCodecError.prototype.toString = function () {\n\treturn 'UnicodeCodecError' + (this.message ? ': ' + this.message : '');\n};\n\nexports.encode = function (unicode_string) {\n\t// Unicode encoder: Given an arbitrary unicode string, returns a string\n\t// of characters with code points in range 0x00 - 0xFF corresponding to\n\t// the bytes of the utf-8 representation of those characters.\n\ttry {\n\t\treturn unescape(encodeURIComponent(unicode_string));\n\t}\n\tcatch (err) {\n\t\tthrow new UnicodeCodecError('invalid input string');\n\t};\n};\nexports.decode = function (bytes) {\n\t// Unicode decoder: Given a string of characters with code points in\n\t// range 0x00 - 0xFF, which, when interpreted as bytes, are valid UTF-8,\n\t// returns the corresponding Unicode string, along with the number of\n\t// bytes in the input string which were successfully parsed.\n\t//\n\t// Unlike most JavaScript utf-8 encode/decode implementations, properly\n\t// deals with partial multi-byte characters at the end of the byte string.\n\tif (/[^\\x00-\\xFF]/.test(bytes)) {\n\t\tthrow new UnicodeCodecError('invalid utf-8 bytes');\n\t};\n\tvar len, len_parsed;\n\tlen = len_parsed = bytes.length;\n\tvar last = len - 1;\n\t// test for non-ascii final byte. if last byte is ascii (00-7F) we're done.\n\tif (bytes.charCodeAt(last) >= 0x80) {\n\t\t// loop through last 3 bytes looking for first initial byte of unicode\n\t\t// multi-byte character. If the initial byte is 4th from the end, we'll\n\t\t// parse the whole string.\n\t\tfor (var i = 1; i <= 3; i++) {\n\t\t\t// initial bytes are in range C0-FF\n\t\t\tif (bytes.charCodeAt(len - i) >= 0xC0) {\n\t\t\t\tlen_parsed = len - i;\n\t\t\t\tbreak;\n\t\t\t};\n\t\t};\n\t\ttry {\n\t\t\t// if the last few bytes are a complete multi-byte character, parse\n\t\t\t// everything (by setting len_parsed)\n\t\t\tdecodeURIComponent(escape(bytes.slice(len_parsed)));\n\t\t\tlen_parsed = len;\n\t\t}\n\t\tcatch (err) { /* pass */ };\n\t};\n\ttry {\n\t\treturn [\n\t\t\tdecodeURIComponent(escape(bytes.slice(0, len_parsed))),\n\t\t\tlen_parsed\n\t\t];\n\t}\n\tcatch (err) {\n\t\tthrow new UnicodeCodecError('invalid utf-8 bytes');\n\t};\n};\n","friendlyPath":"std.utf8"},"./std/uri.js":{"path":"./std/uri.js","directory":"./std/","filename":"uri.js","src":"var attrs = [ \n\t\"source\",\n\t\"protocol\",\n\t\"authority\",\n\t\"userInfo\",\n\t\"user\",\n\t\"password\",\n\t\"host\",\n\t\"port\",\n\t\"relative\",\n\t\"path\",\n\t\"directory\",\n\t\"file\",\n\t\"query\",\n\t\"anchor\"\n];\n\nvar URI = exports = Class(function(supr) {\n\tthis.init = function(url, isStrict) {\n\t\tif (url instanceof URI) {\n\t\t\tfor (var i = 0, attr; attr = attrs[i]; ++i) {\n\t\t\t\tthis['_' + attr] = url['_' + attr];\n\t\t\t}\n\t\t\treturn;\n\t\t}\n\t\t\n\t\tthis._isStrict = isStrict;\n\t\t\n\t\tvar uriData = exports.parse(url, isStrict);\n\t\tfor (var attr in uriData) {\n\t\t\tthis['_' + attr] = uriData[attr];\n\t\t};\n\t}\n  \n\tfor (var i = 0, attr; attr = attrs[i]; ++i) {\n\t\t(function(attr) {\n\t\t\tvar fNameSuffix = attr.charAt(0).toUpperCase() + attr.slice(1);\n\t\t\tthis['get' + fNameSuffix] = function() {\n\t\t\t\treturn this['_' + attr];\n\t\t\t};\n\t\t\tthis['set' + fNameSuffix] = function(val) {\n\t\t\t\tthis['_' + attr] = val;\n\t\t\t\treturn this;\n\t\t\t};\n\t\t}).call(this, attr);\n\t};\n\t\n\tthis.query = function(key) { return exports.parseQuery(this._query)[key]; }\n\tthis.hash = function(key) { return exports.parseQuery(this._anchor)[key]; }\n\t\n\tthis.addHash = function(kvp) {\n\t\tvar hash = exports.parseQuery(this._anchor);\n\t\tfor (var i in kvp) { hash[i] = kvp[i]; }\n\t\tthis._anchor = exports.buildQuery(hash);\n\t\treturn this;\n\t}\n\t\n\tthis.push = function(path) {\n\t\tif (path) {\n\t\t\tthis._path = (this._path + '/' + path).replace(/\\/\\//g, '/');\n\t\t}\n\t\treturn this;\n\t}\n\t\n\tthis.addQuery = function(kvp) {\n\t\tvar query = exports.parseQuery(this._query);\n\t\tfor (var i in kvp) { query[i] = kvp[i]; }\n\t\tthis._query = exports.buildQuery(query);\n\t\treturn this;\n\t}\n\t\n\tthis.removeQuery = function(keys) {\n\t\tvar query = exports.parseQuery(this._query);\n\t\tif (isArray(keys)) {\n\t\t\tfor (var i = 0, n = keys.length; i < n; ++i) {\n\t\t\t\tdelete query[keys[i]];\n\t\t\t}\n\t\t} else {\n\t\t\tdelete query[keys];\n\t\t}\n\t\tthis._query = exports.buildQuery(query);\n\t\treturn this;\n\t}\n\n\tthis.toString = this.render = function(onlyBase) {\n\t\t// XXX TODO: This is vaguely reasonable, but not complete. fix it...\n\t\tvar a = this._protocol ? this._protocol + \"://\" : \"\"\n\t\tvar b = this._host ? this._host + ((this._port || 80) == 80 ? \"\" : \":\" + this._port) : \"\";\n\t\t\n\t\tif (onlyBase) {\n\t\t\treturn a + b;\n\t\t}\n\t\t\n\t\tvar c = this._path;\n\t\tvar d = this._query ? '?' + this._query : '';\n\t\tvar e = this._anchor ? '#' + this._anchor : '';\n\t\treturn a + b + c + d + e;\n\t};\n});\n\nexports.relativeTo = function(url, base) {\n\tif (!base) { return url; }\n\t\n\turl = String(url);\n\t\n\tif (/^http(s?):\\/\\//.test(url)) { return url; }\n\tif (url.charAt(0) == '/') {\n\t\tvar baseuri = new exports(base);\n\t\turl = baseuri.toString(true) + url;\n\t} else {\n\t\turl = base + url;\n\t}\n\t\n\treturn exports.resolveRelative(url);\n}\n\nexports.resolveRelative = function(url) {\n\tvar prevUrl;\n\t\n\t// remove ../ with preceeding folder\n\twhile((prevUrl = url) != (url = url.replace(/(^|\\/)([^\\/]+)\\/\\.\\.\\//g, '/'))) {};\n\t\n\t// remove ./ if it isn't preceeded by a .\n\treturn url.replace(/[^.]\\.\\//g, '');\n}\n\nexports.buildQuery = function(kvp) {\n\tvar pairs = [];\n\tfor (var key in kvp) {\n\t\tpairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(kvp[key]));\n\t}\n\treturn pairs.join('&');\n}\n\nexports.parseQuery = function(str) {\n\tvar pairs = str.split('&'),\n\t\tn = pairs.length,\n\t\tdata = {};\n\tfor (var i = 0; i < n; ++i) {\n\t\tvar pair = pairs[i].split('='),\n\t\t\tkey = decodeURIComponent(pair[0]);\n\t\tif (key) { data[key] = decodeURIComponent(pair[1]); }\n\t}\n\treturn data;\n}\n\n// Regexs are based on parseUri 1.2.2\n// Original: (c) Steven Levithan <stevenlevithan.com>\n// Original: MIT License\n\nvar strictRegex = /^(?:([^:\\/?#]+):)?(?:\\/\\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\\/?#]*)(?::(\\d*))?))?((((?:[^?#\\/]*\\/)*)([^?#]*))(?:\\?([^#]*))?(?:#(.*))?)/;\nvar looseRegex = /^(?:(?![^:@]+:[^:@\\/]*@)([^:\\/?#.]+):)?(?:\\/\\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\\/?#]*)(?::(\\d*))?)(((\\/(?:[^?#](?![^?#\\/]*\\.[^?#\\/.]+(?:[?#]|$)))*\\/?)?([^?#\\/]*))(?:\\?([^#]*))?(?:#(.*))?)/;\nvar queryStringRegex = /(?:^|&)([^&=]*)=?([^&]*)/g;\n\nexports.parse = function(str, isStrict) {\n\tvar regex = isStrict ? strictRegex : looseRegex;\n\tvar result = {};\n\tvar match = regex.exec(str);\n\tfor (var i = 0, attr; attr = attrs[i]; ++i) {\n\t\tresult[attr] = match[i] || \"\";\n\t}\n\t\n\tvar qs = result['queryKey'] = {};\n\tresult['query'].replace(queryStringRegex, function(check, key, val) {\n\t\tif (check) {\n\t\t\tqs[key] = val;\n\t\t}\n\t});\n\t\n\treturn result;\n}\n\nexports.isSameDomain = function(urlA, urlB) {\n\tvar a = exports.parse(urlA);\n\tvar b = exports.parse(urlB);\n\treturn ((a.port == b.port ) && (a.host == b.host) && (a.protocol == b.protocol));\n};\n","friendlyPath":"std.uri"},"./net/errors.js":{"path":"./net/errors.js","directory":"./net/","filename":"errors.js","src":"var makeErrorClass = function(name, _code) {\n\tvar toString = function() {\n\t\treturn name + (this.message ? ': ' + this.message : '');\n\t}\n\n\tvar ctor = function(data) {\n\t\tif (typeof data == 'string') {\n\t\t\tthis.message = data;\n\t\t} else {\n\t\t\tthis.data = data;\n\t\t}\n\t}\n\t\n\tctor.prototype = {\n\t\ttype: name,\n\t\ttoString: toString\n\t};\n\t\n\treturn ctor;\n}\n\nexports.ReadyStateError = makeErrorClass(\"ReadyStateError\");\nexports.InvalidEncodingError = makeErrorClass(\"InvalidEncodingError\");\nexports.ExpiredSession = makeErrorClass(\"ExpiredSession\");\n\nexports.ServerUnreachable = makeErrorClass(\"ServerUnreachable\", 100);\nexports.ConnectionTimeout = makeErrorClass(\"ConnectionTimeout\", 101);\n\nexports.ServerProtocolError = makeErrorClass(\"ServerProtocolError\", 200);\n\nexports.ServerClosedConnection = makeErrorClass(\"ServerClosedConnection\", 301);\nexports.ConnectionClosedCleanly = makeErrorClass(\"ConnectionClosedCleanly\", 300);","friendlyPath":"net.errors"},"./net/csp/transports.js":{"path":"./net/csp/transports.js","directory":"./net/csp/","filename":"transports.js","src":"jsio('import std.uri as uri'); \njsio('import std.base64 as base64');\njsio('from util.browserdetect import BrowserDetect');\n\n;(function() {\n\tvar doc;\n\texports.getDoc = function() {\n\t\tif (doc) { return doc; }\n\t\ttry {\n\t\t\tdoc = window.ActiveXObject && new ActiveXObject('htmlfile');\n\t\t\tif (doc) {\n\t\t\t\tdoc.open().write('<html></html>');\n\t\t\t\tdoc.close();\n\t\t\t\twindow.attachEvent('onunload', function() {\n\t\t\t\t\ttry { doc.body.innerHTML = ''; } catch(e) {}\n\t\t\t\t\tdoc = null;\n\t\t\t\t});\n\t\t\t}\n\t\t} catch(e) {}\n\t\t\n\t\tif (!doc) { doc = document; }\n\t\treturn doc;\n\t};\n\n\texports.XHR = function() {\n\t\tvar win = window,\n\t\t\tdoc = exports.getDoc();\n\t\t//if (doc.parentWindow) { win = doc.parentWindow; }\n\t\t\n\t\treturn new (exports.XHR = win.XMLHttpRequest ? win.XMLHttpRequest\n\t\t\t: function() { return win.ActiveXObject && new win.ActiveXObject('Msxml2.XMLHTTP') || null; });\n\t}\n\t\n\texports.createXHR = function() { return new exports.XHR(); }\n\n})();\n\nfunction isLocalFile(url) { return /^file:\\/\\//.test(url); }\nfunction isWindowDomain(url) { return uri.isSameDomain(url, window.location.href); }\n\nvar xhrSupportsBinary = undefined;\nfunction checkXHRBinarySupport(xhr) {\n\txhrSupportsBinary = !!xhr.sendAsBinary;\n}\n\nfunction canUseXHR(url) {\n\t// always use jsonp for local files\n\tif (isLocalFile(url)) { return false; }\n\t\n\t// try to create an XHR using the same function the XHR transport uses\n\tvar xhr = new exports.XHR();\n\tif (!xhr) { return false; }\n\t\n\tcheckXHRBinarySupport(xhr);\n\t\n\t// if the URL requested is the same domain as the window,\n\t// then we can use same-domain XHRs\n\tif (isWindowDomain(url)) { return true; }\n\t\n\t// if the URL requested is a different domain than the window,\n\t// then we need to check for cross-domain support\n\tif (window.XMLHttpRequest\n\t\t\t&& (xhr.__proto__ == XMLHttpRequest.prototype // WebKit Bug 25205\n\t\t\t\t|| xhr instanceof window.XMLHttpRequest)\n\t\t\t&& xhr.withCredentials !== undefined\n\t\t|| window.XDomainRequest \n\t\t\t&& xhr instanceof window.XDomainRequest) {\n\t\treturn true;\n\t}\n};\n\nvar transports = exports.transports = {};\n\nexports.chooseTransport = function(url, options) {\n\tswitch(options.preferredTransport) {\n\t\tcase 'jsonp':\n\t\t\treturn transports.jsonp;\n\t\tcase 'xhr':\n\t\tdefault:\n\t\t\tif (canUseXHR(url)) { return transports.xhr; };\n\t\t\treturn transports.jsonp;\n\t}\n};\n\n// TODO: would be nice to use these somewhere...\n\nvar PARAMS = {\n\t'xhrstream':   {\"is\": \"1\", \"bs\": \"\\n\"},\n\t'xhrpoll':     {\"du\": \"0\"},\n\t'xhrlongpoll': {},\n\t'sselongpoll': {\"bp\": \"data: \", \"bs\": \"\\r\\n\", \"se\": \"1\"},\n\t'ssestream':   {\"bp\": \"data: \", \"bs\": \"\\r\\n\", \"se\": \"1\", \"is\": \"1\"}\n};\n\nexports.Transport = Class(function(supr) {\n\tthis.handshake = function(url, options) {\n\t\tthrow new Error(\"handshake Not Implemented\"); \n\t};\n\tthis.comet = function(url, sessionKey, lastEventId, options) { \n\t\tthrow new Error(\"comet Not Implemented\"); \n\t};\n\tthis.send = function(url, sessionKey, data, options) { \n\t\tthrow new Error(\"send Not Implemented\");\n\t};\n\tthis.encodePacket = function(packetId, data, options) { \n\t\tthrow new Error(\"encodePacket Not Implemented\"); \n\t};\n\tthis.abort = function() { \n\t\tthrow new Error(\"abort Not Implemented\"); \n\t};\n});\n\nvar baseTransport = Class(exports.Transport, function(supr) {\n\tthis.init = function() {\n\t\tthis._aborted = false;\n\t\tthis._handshakeArgs = {ct:'application/javascript'};\n\t\tthis._handshakeData = '{}'\n\t};\n\t\n\tthis.handshake = function(url, options) {\n\t\tlogger.debug('handshake:', url, options);\n\t\tthis._makeRequest('send', url + '/handshake', \n\t\t\t\t\t\t  this._handshakeArgs,\n\t\t\t\t\t\t  this._handshakeData,\n\t\t\t\t\t\t  this.handshakeSuccess, \n\t\t\t\t\t\t  this.handshakeFailure);\n\t};\n\t\n\tthis.comet = function(url, sessionKey, lastEventId, options) {\n\t\tlogger.debug('comet:', url, sessionKey, lastEventId, options);\n\t\tvar args = {\n\t\t\ts: sessionKey,\n\t\t\ta: lastEventId\n\t\t};\n\t\tthis._makeRequest('comet', url + '/comet', \n\t\t\t\t\t\t  args,\n\t\t\t\t\t\t  null,\n\t\t\t\t\t\t  this.cometSuccess, \n\t\t\t\t\t\t  this.cometFailure);\n\t};\n\t\n\tthis.send = function(url, sessionKey, lastEventId, data, options) {\n\t\t//logger.debug('send:', url, sessionKey, data, options);\n\t\tvar args = {\n\t\t\ts: sessionKey,\n\t\t\ta: lastEventId\n\t\t};\n\t\tthis._makeRequest('send', url + '/send', \n\t\t\t\t\t\t  args,\n\t\t\t\t\t\t  data,\n\t\t\t\t\t\t  this.sendSuccess, \n\t\t\t\t\t\t  this.sendFailure);\n\t};\n});\n\ntransports.xhr = Class(baseTransport, function(supr) {\n\t\n\tthis.init = function() {\n\t\tsupr(this, 'init');\n\t\n\t\tthis._xhr = {\n\t\t\t'send': new exports.XHR(),\n\t\t\t'comet': new exports.XHR()\n\t\t};\n\t};\n\n\tthis.abort = function() {\n\t\tthis._aborted = true;\n\t\tfor(var i in this._xhr) {\n\t\t\tif(this._xhr.hasOwnProperty(i)) {\n\t\t\t\tthis._abortXHR(i);\n\t\t\t}\n\t\t}\n\t};\n\t\n\tthis._abortXHR = function(type) {\n\t\tlogger.debug('aborting XHR');\n\n\t\tvar xhr = this._xhr[type];\n\t\ttry {\n\t\t\tif('onload' in xhr) {\n\t\t\t\txhr.onload = xhr.onerror = xhr.ontimeout = null;\n\t\t\t} else if('onreadystatechange' in xhr) {\n\t\t\t\txhr.onreadystatechange = null;\n\t\t\t}\n\t\t\tif(xhr.abort) { xhr.abort(); }\n\t\t} catch(e) {\n\t\t\tlogger.debug('error aborting xhr', e);\n\t\t}\n\t\t\n\t\t// do not reuse aborted XHRs\n\t\tthis._xhr[type] = new exports.XHR();\n\t};\n\t\n\tthis.encodePacket = function(packetId, data, options) {\n\t\t// we don't need to base64 encode things unless there's a null character in there\n\t\treturn !xhrSupportsBinary ? [ packetId, 1, base64.encode(data) ] : [ packetId, 0, data ];\n\t};\n\n\tfunction onReadyStateChange(xhr, rType, cb, eb) {\n\t\ttry {\n\t\t\tvar data = {status: xhr.status};\n\t\t} catch(e) { eb({response: 'Could not access status'}); }\n\t\t\n\t\ttry {\n\t\t\tif(xhr.readyState != 4) { return; }\n\t\t\t\n\t\t\tdata.response = eval(xhr.responseText);\n\t\t\tif(data.status != 200) { \n\t\t\t\tlogger.debug('XHR failed with status ', xhr.status);\n\t\t\t\teb(data);\n\t\t\t\treturn;\n\t\t\t}\n\t\t\t\n\t\t\tlogger.debug('XHR data received');\n\t\t} catch(e) {\n\t\t\tlogger.debug('Error in XHR::onReadyStateChange', e);\n\t\t\teb(data);\n\t\t\tthis._abortXHR(rType);\n\t\t\tlogger.debug('done handling XHR error');\n\t\t\treturn;\n\t\t}\n\t\t\n\t\tcb(data);\n\t};\n\n\t/**\n\t * even though we encode the POST body as in application/x-www-form-urlencoded\n\t */\n\tthis._makeRequest = function(rType, url, args, data, cb, eb) {\n\t\tif (this._aborted) { return; }\n\t\tvar xhr = this._xhr[rType];\n\t\txhr.open('POST', url + '?' + uri.buildQuery(args)); // must open XHR first\n\t\txhr.setRequestHeader('Content-Type', 'text/plain'); // avoid preflighting\n\t\tif('onload' in xhr) {\n\t\t\txhr.onload = bind(this, onReadyStateChange, xhr, rType, cb, eb);\n\t\t\txhr.onerror = xhr.ontimeout = eb;\n\t\t} else if('onreadystatechange' in xhr) {\n\t\t\txhr.onreadystatechange = bind(this, onReadyStateChange, xhr, rType, cb, eb);\n\t\t}\n\t\t// NOTE WELL: Firefox (and probably everyone else) likes to encode our nice\n\t\t//\t\t\t\t\t\tbinary strings as utf8. Don't let them! Say no to double utf8\n\t\t//\t\t\t\t\t\tencoding. Once is good, twice isn't better.\n\t\t// if (xhrSupportsBinary) {\n\t\t// \t\txhr.setRequestHeader('x-CSP-SendAsBinary', 'true');\n\t\t// }\n\t\tsetTimeout(function() {\n\t\t\txhr[xhrSupportsBinary ? 'sendAsBinary' : 'send'](data || null)\n\t\t}, 0);\n\t};\n});\n\nvar EMPTY_FUNCTION = function() {},\n\tSLICE = Array.prototype.slice;\n\ntransports.jsonp = Class(baseTransport, function(supr) {\n\tvar doc;\n\t\n\tvar createIframe = function() {\n\t\tvar doc = exports.getDoc();\n\t\tif (!doc.body) { return false; }\n\t\t\n\t\tvar i = doc.createElement(\"iframe\");\n\t\twith(i.style) { display = 'block'; width = height = border = margin = padding = '0'; overflow = visibility = 'hidden'; position = 'absolute'; top = left = '-999px'; }\n\t\ti.cbId = 0;\n\t\tdoc.body.appendChild(i);\n\t\ti.src = 'javascript:var d=document;d.open();d.write(\"<html><body></body></html>\");d.close();';\n\t\treturn i;\n\t};\n\n\tvar cleanupIframe = function(ifr) {\n\t\tvar win = ifr.contentWindow, doc = win.document;\n\t\tlogger.debug('removing script tags');\n\t\t\n\t\tvar scripts = doc.getElementsByTagName('script');\n\t\tfor (var i = scripts.length - 1; i >= 0; --i) {\n\t\t\tdoc.body.removeChild(scripts[i]);\n\t\t}\n\t\t\n\t\tlogger.debug('deleting iframe callbacks');\n\t\twin['cb' + ifr.cbId] = win['eb' + ifr.cbId] = EMPTY_FUNCTION;\n\t};\n\n\tvar removeIframe = function(ifr) {\n\t\tsetTimeout(function() {\n\t\t\tif(ifr && ifr.parentNode) { ifr.parentNode.removeChild(ifr); }\n\t\t}, 60000);\n\t};\n\n\tthis.init = function() {\n\t\tsupr(this, 'init');\n\n\t\tthis._onReady = [];\n\t\tthis._isReady = false;\n\n\t\tthis._createIframes();\n\t};\n\n\tthis._createIframes = function() {\n\t\tthis._ifr = {\n\t\t\tsend: createIframe(),\n\t\t\tcomet: createIframe()\n\t\t};\n\t\t\n\t\tif(this._ifr.send === false) { return setTimeout(bind(this, '_createIframes'), 100); }\n\t\t\n\t\tthis._isReady = true;\n\n\t\tvar readyArgs = this._onReady;\n\t\tthis._onReady = [];\n\t\tfor(var i = 0, args; args = readyArgs[i]; ++i) {\n\t\t\tthis._makeRequest.apply(this, args);\n\t\t}\n\t};\n\n\tthis.encodePacket = function(packetId, data, options) {\n\t\treturn [ packetId, 1, base64.encode(data) ];\n\t};\n\n\tthis.abort = function() {\n\t\tthis._aborted = true;\n\t\tfor(var i in this._ifr) {\n\t\t\tif(this._ifr.hasOwnProperty(i)) {\n\t\t\t\tvar ifr = this._ifr[i];\n\t\t\t\tcleanupIframe(ifr);\n\t\t\t\tremoveIframe(ifr);\n\t\t\t}\n\t\t}\n\t};\n\t\n\tthis._makeRequest = function(rType, url, args, data, cb, eb) {\n\t\tif(!this._isReady) { return this._onReady.push(arguments); }\n\t\t\n\t\tvar ifr = this._ifr[rType],\n\t\t\tid = ++ifr.cbId,\n\t\t\treq = {\n\t\t\t\ttype: rType,\n\t\t\t\tid: id,\n\t\t\t\tcb: cb,\n\t\t\t\teb: eb,\n\t\t\t\tcbName: 'cb' + id,\n\t\t\t\tebName: 'eb' + id,\n\t\t\t\tcompleted: false\n\t\t\t};\n\t\t\n\t\targs.d = data;\n\t\targs.n = Math.random();\t\n\t\tswitch(rType) {\n\t\t\tcase 'send': args.rs = ';'; args.rp = req.cbName; break;\n\t\t\tcase 'comet': args.bs = ';'; args.bp = req.cbName; break;\n\t\t}\n\t\t\n\t\treq.url = url + '?' + uri.buildQuery(args)\n\t\t\n\t\tsetTimeout(bind(this, '_request', req), 0);\n\t}\n\t\n\tthis._request = function(req) {\n\t\tvar ifr = this._ifr[req.type],\n\t\t\twin = ifr.contentWindow,\n\t\t\tdoc = win.document,\n\t\t\tbody = doc.body;\n                /*added by skysbird for opera support*/\n                if (!body){return setTimeout(bind(this,'_request',req),100); }\n\t\twin[req.ebName] = bind(this, checkForError, req);\n\t\twin[req.cbName] = bind(this, onSuccess, req);\n\t\t\n\t\tif(BrowserDetect.isWebKit) {\n\t\t\t// this will probably cause loading bars in Safari -- might want to rethink?\n\t\t\tdoc.open();\n\t\t\tdoc.write('<scr'+'ipt src=\"'+req.url+'\"></scr'+'ipt><scr'+'ipt>'+ebName+'(false)</scr'+'ipt>');\n\t\t\tdoc.close();\n\t\t} else {\n\t\t\tvar s = doc.createElement('script');\n\t\t\ts.src = req.url;\n\t\t\t\n\t\t\t// IE\n\t\t\tif(s.onreadystatechange === null) { s.onreadystatechange = bind(this, onReadyStateChange, req, s); }\n\t\t\tbody.appendChild(s);\n\t\t\t\n\t\t\tif(!BrowserDetect.isIE) {\n\t\t\t\tvar s = doc.createElement('script');\n\t\t\t\ts.innerHTML = req.ebName+'(false)';\n\t\t\t\tbody.appendChild(s);\n\t\t\t}\n\t\t}\n\t\t\n\t\tkillLoadingBar();\n\t};\n\t\n\tfunction onSuccess(req, response) {\n\t\tlogger.debug('successful: ', req.url, response);\n\t\treq.completed = true;\n\t\t\n\t\tlogger.debug('calling the cb');\n\t\treq.cb.call(GLOBAL, {status: 200, response: response});\n\t\tlogger.debug('cb called');\n\t}\n\t\n\t// IE6/7 onReadyStateChange\n\tfunction onReadyStateChange(req, scriptTag) {\n\t\tif (scriptTag && scriptTag.readyState != 'loaded') { return; }\n\t\tscriptTag.onreadystatechange = function() {};\n\t\tcheckForError.call(this, req);\n\t}\n\n\tfunction checkForError(req, response) {\n\t\tcleanupIframe(this._ifr[req.type]);\n\t\t\n\t\tif (!req.completed) {\n\t\t\tvar data = {\n\t\t\t\tstatus: response ? 200 : 404,\n\t\t\t\tresponse: response || 'Unable to load resouce'\n\t\t\t};\n\t\t\t\n\t\t\tlogger.debug('error making request:', req.url, data);\n\t\t\tlogger.debug('calling eb');\n\t\t\treq.eb.call(GLOBAL, data);\n\t\t}\n\t}\n\t\n\tvar killLoadingBar = BrowserDetect.isFirefox || BrowserDetect.isOpera ? function() {\n\t\tvar b = document.body;\n\t\tif (!b) { return; }\n\t\t\n\t\tif (!killLoadingBar.iframe) { killLoadingBar.iframe = document.createElement('iframe'); }\n\t\tb.insertBefore(killLoadingBar.iframe, b.firstChild);\n\t\tb.removeChild(killLoadingBar.iframe);\n\t} : function() {};\n});\n\t\n","friendlyPath":".transports"},"./util/browserdetect.js":{"path":"./util/browserdetect.js","directory":"./util/","filename":"browserdetect.js","baseMod":"util","basePath":"./","src":"exports.BrowserDetect = new function() {\n\tvar versionSearchString;\n\tvar dataBrowser = [\n\t\t{\n\t\t\tstring: navigator.userAgent,\n\t\t\tsubString: \"Chrome\"\n\t\t},\n\t\t{\n\t\t\tstring: navigator.userAgent,\n\t\t\tsubString: \"OmniWeb\",\n\t\t\tversionSearch: \"OmniWeb/\"\n\t\t},\n\t\t{\n\t\t\tstring: navigator.vendor,\n\t\t\tsubString: \"Apple\",\n\t\t\tidentity: \"Safari\",\n\t\t\tversionSearch: \"Version\"\n\t\t},\n\t\t{\n\t\t\tprop: window.opera,\n\t\t\tidentity: \"Opera\"\n\t\t},\n\t\t{\n\t\t\tstring: navigator.vendor,\n\t\t\tsubString: \"iCab\"\n\t\t},\n\t\t{\n\t\t\tstring: navigator.vendor,\n\t\t\tsubString: \"KDE\",\n\t\t\tidentity: \"Konqueror\"\n\t\t},\n\t\t{\n\t\t\tstring: navigator.userAgent,\n\t\t\tsubString: \"Firefox\"\n\t\t},\n\t\t{\n\t\t\tstring: navigator.vendor,\n\t\t\tsubString: \"Camino\"\n\t\t},\n\t\t{\t\t// for newer Netscapes (6+)\n\t\t\tstring: navigator.userAgent,\n\t\t\tsubString: \"Netscape\"\n\t\t},\n\t\t{\n\t\t\tstring: navigator.userAgent,\n\t\t\tsubString: \"MSIE\",\n\t\t\tidentity: \"IE\",\n\t\t\tversionSearch: \"MSIE\"\n\t\t},\n\t\t{\n\t\t\tstring: navigator.userAgent,\n\t\t\tsubString: \"Gecko\",\n\t\t\tidentity: \"Mozilla\",\n\t\t\tversionSearch: \"rv\"\n\t\t},\n\t\t{ \t\t// for older Netscapes (4-)\n\t\t\tstring: navigator.userAgent,\n\t\t\tsubString: \"Mozilla\",\n\t\t\tidentity: \"Netscape\",\n\t\t\tversionSearch: \"Mozilla\"\n\t\t}\n\t];\n\t\n\tvar dataOS = [\n\t\t{\n\t\t\tstring: navigator.platform,\n\t\t\tsubString: \"Win\",\n\t\t\tidentity: \"Windows\"\n\t\t},\n\t\t{\n\t\t\tstring: navigator.platform,\n\t\t\tsubString: \"Mac\"\n\t\t},\n\t\t{\n\t\t\tstring: navigator.userAgent,\n\t\t\tsubString: \"iPhone\",\n\t\t\tidentity: \"iPhone/iPod\"\n\t\t},\n\t\t{\n\t\t\tstring: navigator.platform,\n\t\t\tsubString: \"Linux\"\n\t\t}\n\t];\n\t\n\tfunction searchString(data) {\n\t\tfor (var i=0,item;item=data[i];i++)\t{\n\t\t\tvar dataString = item.string;\n\t\t\tvar dataProp = item.prop;\n\t\t\titem.identity = item.identity || item.subString;\n\t\t\tversionSearchString = item.versionSearch || item.identity;\n\t\t\tif (dataString) {\n\t\t\t\tif (dataString.indexOf(item.subString) != -1)\n\t\t\t\t\treturn item.identity;\n\t\t\t} else if (dataProp)\n\t\t\t\treturn item.identity;\n\t\t}\n\t}\n\t\n\tfunction searchVersion(dataString) {\n\t\tvar index = dataString.indexOf(versionSearchString);\n\t\tif (index == -1) return;\n\t\treturn parseFloat(dataString.substring(index+versionSearchString.length+1));\n\t}\n\t\n\tthis.browser = searchString(dataBrowser) || \"unknown\";\n\tthis.version = searchVersion(navigator.userAgent)\n\t\t|| searchVersion(navigator.appVersion)\n\t\t|| \"unknown\";\n\tthis.OS = searchString(dataOS) || \"unknown\";\n\tthis.isWebKit = RegExp(\" AppleWebKit/\").test(navigator.userAgent);\n\tthis['is'+this.browser] = this.version;\n};","friendlyPath":"util.browserdetect"},"./std/JSON.js":{"path":"./std/JSON.js","directory":"./std/","filename":"JSON.js","src":"// Based on json2.js (version 2009-09-29) http://www.JSON.org/json2.js\n// exports createGlobal, stringify, parse, stringifyDate\n\n/**\n * if a global JSON object doesn't exist, create one\n */\nexports.createGlobal = function() {\n\tif(typeof JSON == 'undefined') { JSON = {}; }\n\tif(typeof JSON.stringify !== 'function') {\n\t\tJSON.stringify = exports.stringify;\n\t}\n\tif(typeof JSON.parse !== 'function') {\n\t\tJSON.parse = exports.parse;\n\t}\n};\n\n;(function() {\n\tvar cx = /[\\u0000\\u00ad\\u0600-\\u0604\\u070f\\u17b4\\u17b5\\u200c-\\u200f\\u2028-\\u202f\\u2060-\\u206f\\ufeff\\ufff0-\\uffff]/g,\n\t\tescapable = /[\\\\\\\"\\x00-\\x1f\\x7f-\\x9f\\u00ad\\u0600-\\u0604\\u070f\\u17b4\\u17b5\\u200c-\\u200f\\u2028-\\u202f\\u2060-\\u206f\\ufeff\\ufff0-\\uffff]/g,\n\t\tgap,\n\t\tindent,\n\t\tmeta = {\t// table of character substitutions\n\t\t\t'\\b': '\\\\b',\n\t\t\t'\\t': '\\\\t',\n\t\t\t'\\n': '\\\\n',\n\t\t\t'\\f': '\\\\f',\n\t\t\t'\\r': '\\\\r',\n\t\t\t'\"' : '\\\\\"',\n\t\t\t'\\\\': '\\\\\\\\'\n\t\t},\n\t\trep;\n\t\n\tfunction quote(string) {\n\t\t// quote the string if it doesn't contain control characters, quote characters, and backslash characters\n\t\t// otherwise, replace those characters with safe escape sequences\n\t\tescapable.lastIndex = 0;\n\t\treturn escapable.test(string)\n\t\t\t? '\"' + string.replace(escapable, function (a) {\n\t\t\t\t\tvar c = meta[a];\n\t\t\t\t\treturn typeof c === 'string' ? c : '\\\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);\n\t\t\t\t}) + '\"'\n\t\t\t: '\"' + string + '\"';\n\t}\n\t\n\t// Produce a string from holder[key].\n\tfunction str(key, holder) {\n\t\tvar mind = gap, value = holder[key];\n\t\t\n\t\t// If the value has a toJSON method, call it to obtain a replacement value.\n\t\tif (value && typeof value === 'object' && typeof value.toJSON === 'function') {\n\t\t\tvalue = value.toJSON(key);\n\t\t}\n\t\t\n\t\t// If we were called with a replacer function, then call the replacer to\n\t\t// obtain a replacement value.\n\t\tif (typeof rep === 'function') { value = rep.call(holder, key, value); }\n\t\t\n\t\tswitch (typeof value) {\n\t\t\tcase 'string':\n\t\t\t\treturn quote(value);\n\t\t\tcase 'number':\n\t\t\t\t// JSON numbers must be finite\n\t\t\t\treturn isFinite(value) ? String(value) : 'null';\n\t\t\tcase 'boolean':\n\t\t\t\treturn String(value);\n\t\t\tcase 'object': // object, array, date, null\n\t\t\t\tif (value === null) { return 'null'; } // typeof null == 'object'\n\t\t\t\tif (value.constructor === Date) { return exports.stringifyDate(value); }\n\t\t\t\n\t\t\t\tgap += indent;\n\t\t\t\tvar partial = [];\n\t\t\t\t\n\t\t\t\t// Is the value an array?\n\t\t\t\tif (value.constructor === Array) {\n\t\t\t\t\tvar length = value.length;\n\t\t\t\t\tfor (var i = 0; i < length; i += 1) {\n\t\t\t\t\t\tpartial[i] = str(i, value) || 'null';\n\t\t\t\t\t}\n\t\t\t\t\t\n\t\t\t\t\t// Join all of the elements together, separated with commas, and wrap them in brackets.\n\t\t\t\t\tvar v = partial.length === 0 ? '[]' :\n\t\t\t\t\t\tgap ? '[\\n' + gap +\n\t\t\t\t\t\t\t\tpartial.join(',\\n' + gap) + '\\n' +\n\t\t\t\t\t\t\t\t\tmind + ']' :\n\t\t\t\t\t\t\t  '[' + partial.join(',') + ']';\n\t\t\t\t\tgap = mind;\n\t\t\t\t\treturn v;\n\t\t\t\t}\n\t\t\t\t\n\t\t\t\tif (rep && typeof rep === 'object') { // rep is an array\n\t\t\t\t\tvar length = rep.length;\n\t\t\t\t\tfor (var i = 0; i < length; i += 1) {\n\t\t\t\t\t\tvar k = rep[i];\n\t\t\t\t\t\tif (typeof k === 'string') {\n\t\t\t\t\t\t\tvar v = str(k, value);\n\t\t\t\t\t\t\tif (v) {\n\t\t\t\t\t\t\t\tpartial.push(quote(k) + (gap ? ': ' : ':') + v);\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t} else { // iterate through all of the keys in the object.\n\t\t\t\t\tfor (var k in value) {\n\t\t\t\t\t\tif (Object.hasOwnProperty.call(value, k)) {\n\t\t\t\t\t\t\tvar v = str(k, value);\n\t\t\t\t\t\t\tif (v) {\n\t\t\t\t\t\t\t\tpartial.push(quote(k) + (gap ? ': ' : ':') + v);\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\n\t\t\t\t// Join all of the member texts together, separated with commas,\n\t\t\t\t// and wrap them in braces.\n\t\t\t\tvar v = partial.length === 0 ? '{}' :\n\t\t\t\t\tgap ? '{\\n' + gap + partial.join(',\\n' + gap) + '\\n' +\n\t\t\t\t\t\t\tmind + '}' : '{' + partial.join(',') + '}';\n\t\t\t\tgap = mind;\n\t\t\t\treturn v;\n\t\t}\n\t}\n\n\n\t/**\n\t * The stringify method takes a value and an optional replacer, and an optional\n\t * space parameter, and returns a JSON text. The replacer can be a function\n\t * that can replace values, or an array of strings that will select the keys.\n \t * A default replacer method can be provided. Use of the space parameter can\n\t * produce text that is more easily readable.\n\t */\n\texports.stringify = function (value, replacer, space) {\n\t\tgap = '';\n\t\tindent = '';\n\t\t\n\t\t// If the space parameter is a number, make an indent string containing that many spaces.\n\t\tif (typeof space === 'number') {\n\t\t\tfor (var i = 0; i < space; i += 1) {\n\t\t\t\tindent += ' ';\n\t\t\t}\n\t\t} else if (typeof space === 'string') {\n\t\t\tindent = space;\n\t\t}\n\t\t\n\t\t// If there is a replacer, it must be a function or an array.\n\t\trep = replacer;\n\t\tif (replacer && typeof replacer !== 'function' &&\n\t\t\t\t(typeof replacer !== 'object' ||\n\t\t\t\t typeof replacer.length !== 'number')) {\n\t\t\tthrow new Error('JSON stringify: invalid replacer');\n\t\t}\n\t\t\n\t\t// Make a fake root object containing our value under the key of ''.\n\t\t// Return the result of stringifying the value.\n\t\treturn str('', {'': value});\n\t};\n\t\n\texports.stringifyDate = function(d) {\n\t\tvar year = d.getUTCFullYear(),\n\t\t\tmonth = d.getUTCMonth() + 1,\n\t\t\tday = d.getUTCDate(),\n\t\t\thours = d.getUTCHours(),\n\t\t\tminutes = d.getUTCMinutes(),\n\t\t\tseconds = d.getUTCSeconds(),\n\t\t\tms = d.getUTCMilliseconds();\n\t\t\n\t\tif (month < 10) { month = '0' + month; }\n\t\tif (day < 10) { day = '0' + day; }\n\t\tif (hours < 10) { hours = '0' + hours; }\n\t\tif (minutes < 10) { minutes = '0' + minutes; }\n\t\tif (seconds < 10) { seconds = '0' + seconds; }\n\t\tif (ms < 10) { ms = '00' + ms; }\n\t\telse if (ms < 100) { ms = '0' + ms; }\n\n\t\treturn '\"' + year\n\t\t\t+ '-' + month\n\t\t\t+ '-' + day\n\t\t\t+ 'T' + hours\n\t\t\t+ ':' + minutes\n\t\t\t+ ':' + seconds\n\t\t\t+ '.' + ms\n\t\t\t+ 'Z\"';\n\t}\n\t\n\t/**\n\t * The parse method takes a text and an optional reviver function, and returns\n\t * a JavaScript value if the text is a valid JSON text.\n\t */\n\texports.parse = function (text, reviver) {\n\t\t// Parsing happens in four stages. In the first stage, we replace certain\n\t\t// Unicode characters with escape sequences. JavaScript handles many characters\n\t\t// incorrectly, either silently deleting them, or treating them as line endings.\n\t\tcx.lastIndex = 0;\n\t\tif (cx.test(text)) {\n\t\t\ttext = text.replace(cx, function (a) {\n\t\t\t\treturn '\\\\u' +\n\t\t\t\t\t('0000' + a.charCodeAt(0).toString(16)).slice(-4);\n\t\t\t});\n\t\t}\n\t\t\n\t\t// In the second stage, we run the text against regular expressions that look\n\t\t// for non-JSON patterns. We are especially concerned with '()' and 'new'\n\t\t// because they can cause invocation, and '=' because it can cause mutation.\n\t\t// But just to be safe, we want to reject all unexpected forms.\n\n\t\t// We split the second stage into 4 regexp operations in order to work around\n\t\t// crippling inefficiencies in IE's and Safari's regexp engines. First we\n\t\t// replace the JSON backslash pairs with '@' (a non-JSON character). Second, we\n\t\t// replace all simple value tokens with ']' characters. Third, we delete all\n\t\t// open brackets that follow a colon or comma or that begin the text. Finally,\n\t\t// we look to see that the remaining characters are only whitespace or ']' or\n\t\t// ',' or ':' or '{' or '}'. If that is so, then the text is safe for eval.\n\n\t\tif (/^[\\],:{}\\s]*$/\n\t\t\t\t.test(text.replace(/\\\\(?:[\"\\\\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@')\n\t\t\t\t.replace(/\"[^\"\\\\\\n\\r]*\"|true|false|null|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?/g, ']')\n\t\t\t\t.replace(/(?:^|:|,)(?:\\s*\\[)+/g, '')))\n\t\t{\n\t\t\tvar j = eval('(' + text + ')');\n\t\t\tif(!reviver) {\n\t\t\t\treturn j;\n\t\t\t} else {\n\t\t\t\t// In the optional fourth stage, we recursively walk the new structure, passing\n\t\t\t\t// each name/value pair to a reviver function for possible transformation.\n\t\t\t\tvar walk = function(holder, key) {\n\t\t\t\t\t// The walk method is used to recursively walk the resulting structure so\n\t\t\t\t\t// that modifications can be made.\n\t\t\t\t\tvar k, v, value = holder[key];\n\t\t\t\t\tif (value && typeof value === 'object') {\n\t\t\t\t\t\tfor (k in value) {\n\t\t\t\t\t\t\tif (Object.hasOwnProperty.call(value, k)) {\n\t\t\t\t\t\t\t\tv = walk(value, k);\n\t\t\t\t\t\t\t\tif (v !== undefined) {\n\t\t\t\t\t\t\t\t\tvalue[k] = v;\n\t\t\t\t\t\t\t\t} else {\n\t\t\t\t\t\t\t\t\tdelete value[k];\n\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t\treturn reviver.call(holder, key, value);\n\t\t\t\t}\n\t\t\t\treturn walk({'': j}, '');\n\t\t\t}\n\t\t}\n\n\t\t// If the text is not JSON parseable, then a SyntaxError is thrown.\n\t\tthrow new SyntaxError('JSON.parse');\n\t};\n}());","friendlyPath":"std.JSON"},"./net/protocols/buffered.js":{"path":"./net/protocols/buffered.js","directory":"./net/protocols/","filename":"buffered.js","src":"jsio('from net.interfaces import Protocol');\njsio('from net.buffer import Buffer');\n\nexports.BufferedProtocol = Class(Protocol, function(supr) {\n\n\tthis.init = function() {\n\t\tthis.buffer = new Buffer();\n\t}\n\n\t// Overwrite this instead of dataReceived in base classes\n\tthis.bufferUpdated = function() {}\n\n\tthis.dataReceived = function(data) {\n\t\tthis.buffer.append(data);\n\t\tthis.bufferUpdated();\n\t}\n\n})","friendlyPath":"net.protocols.buffered"},"./net/buffer.js":{"path":"./net/buffer.js","directory":"./net/","filename":"buffer.js","src":"jsio('from net.interfaces import Protocol');\n\nvar EmptyBufferError = exports.EmptyBufferError = Class(function () {\n\tthis.init = function(message) { this.message = message; }\n})\n\nexports.Buffer = Class(function(supr) {\n\n\tthis.init = function(rawBuffer) {\n\t\t\n\t\tthis._rawBuffer = !!rawBuffer ? rawBuffer : \"\";\n\t}\n\n\tthis.getLength = function() {\n\t\treturn this._rawBuffer.length;\n\t}\n\n\tthis.append = function(data) {\n\t\tlogger.debug('append', JSON.stringify(data));\n\t\tthis._rawBuffer += data;\n\t}\n\n\tthis.peekBytes = function(num) {\n\t\tif (!!num)\n\t\t\treturn this._rawBuffer.slice(0, num);\n\t\telse \n\t\t\treturn this._rawBuffer;\n\t}\n\n\tthis.peekToDelimiter = function(delimiter) {\n\t\tdelimiter = delimiter ? delimiter : '\\n';\n\t\tvar i = this._rawBuffer.indexOf(delimiter);\n\t\tif (i == -1)\n\t\t\tthrow new EmptyBufferError(\"delimiter \" + delimiter + \"not present in buffer\");\n\t\telse\n\t\t\treturn this._rawBuffer.slice(0, i);\n\t}\n\n\tthis.consumeBytes = function(num) {\n\t\tvar output = this.peekBytes(num);\n\t\tthis._rawBuffer = this._rawBuffer.slice(output.length);\n\t\treturn output;\n\t}\n\tthis.consumeMaxBytes = function(num) {\n\t\tvar output = this._rawBuffer.slice(0, num);\n\t\tthis._rawBuffer = this._rawBuffer(num);\n\t\treturn output;\n\t}\n\tthis.consumeAllBytes = function() {\n\t\tvar temp = this._rawBuffer;\n\t\tthis._rawBuffer = \"\";\n\t\treturn temp;\n\t}\n\t\n\tthis.consumeThroughDelimiter = function(delimiter) {\n\t\treturn this.consumeToDelimiter(delimiter) + this.consumeBytes(delimiter.length);\n\t}\n\n\tthis.consumeToDelimiter = function(delimiter) {\n\t\tdelimiter = !!delimiter ? delimiter : \"\\n\"\n\t\tvar output = this.peekToDelimiter(delimiter);\n\t\tthis._rawBuffer = this._rawBuffer.slice(output.length);\n\t\treturn output;\n\t}\n\n\tthis.hasBytes = function(num) {\n\t\tnum = num ? num : 0;\n\t\treturn this._rawBuffer.length >= num;\n\t}\n\n\tthis.hasDelimiter = function(delimiter) {\n\t\tdelimiter = !!delimiter ? delimiter : '\\n';\n\t\treturn (this._rawBuffer.indexOf(delimiter) != -1);\n\t}\n\n})\n","friendlyPath":"net.buffer"}};
		if (cloneFrom && cloneFrom.__srcCache) { sourceCache = jsio.__srcCache = cloneFrom.__srcCache; }

		(function() {
			this.__filename = 'jsio.js';
			this.__preprocessors = {};
			this.__cmds = [];
			this.__jsio = this;
			this.__importer = importer;
			this.__modules = {preprocessors:{}};
		
			this.path = {
				set: function(path) { this.value = (typeof path == 'string' ? [path] : path); },
				get: function() { return this.value.slice(0); },
				add: function(path) {
					var v = this.value, len = v.length;
					for (var i = 0; i < len; ++i) {
						if (v[i] == path) { return; }
					}
					v.push(path);
				},
				remove: function(path) {
					var v = this.value, len = v.length;
					for (var i = 0; i < len; ++i) {
						if (v[i] == path) {
							v.splice(i, 1);
						}
					}
				},
				value: [],
				cache: {}
			};
		
			this.addPath = util.bind(this.path, 'add');
		
			this.setCachedSrc = function(path, src) { sourceCache[path] = { path: path, src: src }; }
			this.getCachedSrc = function(path) { return sourceCache[path]; }
		
			this.addPreprocessor = function(name, preprocessor) { this.__preprocessors[name] = preprocessor; }
			this.addCmd = function(processor) { this.__cmds.push(processor); }
		
			this.setEnv = function(envCtor) {
				if (!envCtor && cloneFrom) {
					ENV = cloneFrom.__env;
				} else if (typeof envCtor == 'string') {
					switch(envCtor) {
						case 'node':
							ENV = new ENV_node(util);
							break;
						case 'browser':
						default:
							ENV = new ENV_browser(util);
							break;
					}
				} else {
					ENV = new envCtor(util);
				}
			
				this.__env = ENV;
				this.__dir = ENV.getCwd();
				this.path.set(ENV.getPath());
			}
		}).call(jsio);
	
		if (cloneFrom) {
			jsio.setEnv();
		} else if (typeof process !== 'undefined' && process.version) {
			jsio.setEnv('node');
		} else if (typeof XMLHttpRequest != 'undefined' || typeof ActiveXObject != 'undefined') {
			jsio.setEnv('browser');
		}

		/*
		function ENV_abstract() {
			this.global = null;
			this.getCwd = function() {};
			this.getPath = function() {};
			this.eval = function(code, path) {};
			this.fetch = function(path) { return contentsOfPath; };
			this.log = function(args...) {};
		}
		*/
	
		function ENV_node() {
			var fs = require('fs'),
				sys = require('sys');
		
			this.name = 'node';
			this.global = GLOBAL;
			this.getCwd = process.cwd;
			this.log = function() {
				var msg;
				try {
					sys.error(msg = Array.prototype.map.call(arguments, function(a) {
						if ((a instanceof Error) && a.message) {
							return 'Error:' + a.message + '\nStack:' + a.stack + '\nArguments:' + a.arguments;
						}
						return typeof a == 'string' ? a : JSON.stringify(a);
					}).join(' '));
				} catch(e) {
					sys.error(msg = Array.prototype.join.call(arguments, ' ') + '\n');
				}
				return msg;
			}
		
			this.getPath = function() {
				var segments = __filename.split('/');
				segments.pop();
				return util.makeRelativePath(segments.join('/') || '.', this.getCwd());
			}
			this.eval = process.compile;
		
			this.fetch = function(path) {
				try { return fs.readFileSync(path, 'utf8'); } catch(e) {}
				return false;
			}
		
			this.require = require;
		}
	
		function ENV_browser() {
			var XHR = window.XMLHttpRequest || function() { return new ActiveXObject("Msxml2.XMLHTTP"); },
				cwd = null,
				path = null;
		
			this.name = 'browser';
			this.global = window;
			this.global.jsio = jsio;
		
			this.log = function() {
				var args = SLICE.call(arguments, 0);
				if (typeof console != 'undefined' && console.log) {
					//for iOS mobile safari w/ debugger console enabled,
					//uncomment the following two lines for more useful
					//messages
					//console.log(args.join(' '));
					//return;
					
					if (console.log.apply) {
						console.log.apply(console, arguments);
					} else { // IE doesn't support log.apply, and the argument cannot be arguments - it must be an array
						console.log(args);
					}
				}
				return args.join(' ');
			}
		
			this.getCwd = function() {
				if(!cwd) {
					var loc = window.location, path = loc.pathname;
					cwd = loc.protocol + '//' + loc.host + path.substring(0, path.lastIndexOf('/') + 1);
				}
				return cwd;
			}
		
			this.getPath = function() {
				if(!path) {
					try {
						var filename = new RegExp('(.*?)' + jsio.__filename + '(\\?.*)?$'),
							scripts = document.getElementsByTagName('script');
					
						for (var i = 0, script; script = scripts[i]; ++i) {
							var result = script.src.match(filename);
							if (result) {
								path = result[1];
								if (/^[A-Za-z]*:\/\//.test(path)) { path = util.makeRelativePath(path, this.getCwd()); }
								break;
							}
						}
					} catch(e) {}
				
					if(!path) { path = '.'; }
				}
				return path;
			}
		
			this.debugPath = function(path) { return path; }

			// IE6 won't return an anonymous function from eval, so use the function constructor instead
			var rawEval = typeof eval('(function(){})') == 'undefined'
				? function(src, path) { return (new Function('return ' + src))(); }
				: function(src, path) { var src = src + '\n//@ sourceURL=' + path; return window.eval(src); };

			// provide an eval with reasonable debugging
			this.eval = function(code, path, origCode) {
				try {
					return rawEval(code, this.debugPath(path));
				} catch(e) {
					if(e instanceof SyntaxError) {
						ENV.log("a syntax error is preventing execution of " + path);
						if (DEBUG && this.checkSyntax) {
							this.checkSyntax(origCode, path);
						}
					}
					throw e;
				}
			}
		
			this.checkSyntax = function(code, path) {
				try {
					var syntax = jsio('import util.syntax', {suppressErrors: true, dontExport: true}),
						result = syntax(code);
					syntax.display(result, path);
				} catch(e) {}
			}
		
			this.fetch = function(path) {
				var xhr = new XHR();
				try {
					xhr.open('GET', path, false);
					xhr.send(null);
				} catch(e) {
					ENV.log('e:', e);
					return false; // firefox file://
				}
			
				if (xhr.status == 404 || // all browsers, http://
					xhr.status == -1100 || // safari file://
					// XXX: We have no way to tell in opera if a file exists and is empty, or is 404
					// XXX: Use flash?
					//(!failed && xhr.status == 0 && !xhr.responseText && EXISTS)) // opera
					false)
				{
					return false;
				}
			
				return xhr.responseText;
			}
		};
	
		var preprocessorCheck = /^"use (.*?)"\s*;\s*\n/,
			preprocessorFunc = /^(.+)\(.+\)$/,
			failedFetch = {};
	
		function findModule(possibilities, opts) {
			var src;
			for (var i = 0, possible; possible = possibilities[i]; ++i) {
				var path = possible.path,
					cachedVersion = sourceCache[path];
				
				if (cachedVersion) {
					possible.src = cachedVersion.src;
					return possible;
				}
			
				/*if (/^\.\//.test(path)) {
					// remove one path segment for each dot from the cwd 
					path = addEndSlash(ENV.getCwd()) + path;
				}*/
			
				src = ENV.fetch(path);
			
				if (src !== false) {
					possible.src = src;
					return possible;
				} else {
					failedFetch[path] = true;
				}
			}
		
			return false;
		}
	
		// load a module from a file
		function loadModule(fromDir, fromFile, modulePath, opts) {
			var possibilities = util.resolveModulePath(modulePath, fromDir);
			for (var i = 0, p; p = possibilities[i]; ++i) {
				var path = possibilities[i].path;
				if (!opts.reload && (path in jsio.__modules)) {
					return possibilities[i];
				}
				if (path in failedFetch) { possibilities.splice(i--, 1); }
			}
		
			if (!possibilities.length) {
				if (opts.suppressErrors) { return false; }
				var e = new Error('Module failed to load (again)');
				e.jsioLogged = true;
				throw e;
			}
		
			var moduleDef = findModule(possibilities, opts),
				match;
		
			if (!moduleDef) {
				if (opts.suppressErrors) { return false; }
				var paths = [];
				for (var i = 0, p; p = possibilities[i]; ++i) { paths.push(p.path); }
				throw new Error(fromDir + fromFile + ": \n\tcurrent directory: " + ENV.getCwd() + "\n\tlooked in:\n\t\t" + paths.join('\n\t\t') + '\n\tImport Stack:\n\t\t' + importStack.join('\n\t\t') + "\n\tError: requested import (" + modulePath + ") not found.");
			}
		
			moduleDef.friendlyPath = modulePath;
		
			if (moduleDef.baseMod && !(moduleDef.baseMod in jsio.path.cache)) {
				jsio.path.cache[moduleDef.baseMod] = moduleDef.basePath;
			}
		
			// the order here is somewhat arbitrary and might be overly restrictive (... or overly powerful)
			while (moduleDef.src.charAt(0) == '"' && (match = moduleDef.src.match(preprocessorCheck))) {
				moduleDef.src = moduleDef.src.substring(match[0].length - 1);
				applyPreprocessors(fromDir, moduleDef, match[1].split(','), opts);
			}
			
			if (opts.preprocessors) {
				applyPreprocessors(fromDir, moduleDef, opts.preprocessors, opts);
			}
			
			return moduleDef;
		}
	
		function applyPreprocessors(path, moduleDef, names, opts) {
			for (var i = 0, len = names.length; i < len; ++i) {
				p = getPreprocessor(names[i]);
				if (p) {
					p(path, moduleDef, opts);
				}
			}
		}
		
		function getPreprocessor(name) {
			return typeof name == 'function'
				? name
				: (jsio.__modules['preprocessors.' + name] 
					|| jsio('import preprocessors.' + name, {dontExport: true}));
		}
	
		function execModuleDef(context, moduleDef) {
			var code = "(function(_){with(_){delete _;return function $$" + moduleDef.friendlyPath.replace(/[\/.]/g, '_') + "(){" + moduleDef.src + "\n}}})";
			var fn = ENV.eval(code, moduleDef.path, moduleDef.src);
			fn = fn(context);
			fn.call(context.exports);
		};
		
		function resolveImportRequest(context, request, opts) {
			var cmds = jsio.__cmds,
				imports = [],
				result = false;
		
			for (var i = 0, imp; imp = cmds[i]; ++i) {
				if ((result = imp(context, request, opts, imports))) { break; }
			}
		
			if (result !== true) {
				throw new (typeof SyntaxError != 'undefined' ? SyntaxError : Error)(String(result || 'invalid jsio command: jsio(\'' + request + '\')'));
			}
		
			return imports;
		};
	
		function makeContext(ctx, modulePath, moduleDef, dontAddBase) {
			if (!ctx) { ctx = {}; }
			if (!ctx.exports) { ctx.exports = {}; }

			ctx.jsio = util.bind(this, importer, ctx, moduleDef.directory, moduleDef.filename);
			ctx.require = function(request, opts) {
				if (!opts) { opts = {}; }
				opts.dontExport = true;
				opts.suppressErrors = true;
			
				try {
					var ret = ctx.jsio(request, opts);
					if (ret === false) {
						// need this to trigger require attempt due to suppresserrors = true
						throw "module failed to load";
					} else {
						return ret;
					}
				} catch(e) {
					try {
						return require(request);
					} catch(e2) {
						ENV.log('Error loading request ' + request + ':');
						ENV.log(e);

						ENV.log('Also could not load using standard CommonJS');
						ENV.log(e2);

						throw e;
					}
				}
			};
		
			ctx.module = {id: modulePath, exports: ctx.exports};
			if (!dontAddBase && modulePath != 'base') {
				ctx.jsio('from base import *');
				ctx.logging.__create(modulePath, ctx);
			}
		
			// TODO: FIX for "trailing ." case
			ctx.jsio.__jsio = jsio;
			ctx.jsio.__env = jsio.__env;
			ctx.jsio.__dir = moduleDef.directory;
			ctx.jsio.__filename = moduleDef.filename;
			ctx.jsio.__path = modulePath;
			ctx.jsio.path = jsio.path;
			return ctx;
		};
		
		var importStack = [];
		function importer(boundContext, fromDir, fromFile, request, opts) {
			opts = opts || {};
			fromDir = fromDir || './';
			fromFile = fromFile || '<initial file>';
		
			// importer is bound to a module's (or global) context -- we can override this
			// by using opts.exportInto
			var exportInto = opts.exportInto || boundContext || ENV.global;
		
			// parse the import request(s)
			var imports = resolveImportRequest(exportInto, request, opts),
				numImports = imports.length,
				retVal = numImports > 1 ? {} : null;
		
			// import each requested item
			for(var i = 0; i < numImports; ++i) {
				var item = imports[i],
					modulePath = item.from,
					modules = jsio.__modules;
			
				try {
					var moduleDef = loadModule(fromDir, fromFile, modulePath, opts);
					if (moduleDef === false) { return false; }
				} catch(e) {
					if (!e.jsioLogged) {
						ENV.log('\nError loading module:\n\trequested:', modulePath, '\n\tfrom:', fromDir + fromFile, '\n\tfull request:', request, '\n');
						e.jsioLogged = true;
					}
					throw e;
				}
				
				importStack.push(importStack.length + ' : ' + moduleDef.friendlyPath + ' (' + moduleDef.path + ')');
				
				// eval any packages that we don't know about already
				var path = moduleDef.path;
				if(!(path in modules)) {
					var newContext = makeContext(opts.context, modulePath, moduleDef, item.dontAddBase);
					modules[path] = newContext.exports;
					if(item.dontUseExports) {
						var src = [';(function(){'], k = 1;
						for (var j in item['import']) {
							newContext.exports[j] = undefined;
							src[k++] = 'if(typeof '+j+'!="undefined"&&exports.'+j+'==undefined)exports.'+j+'='+j+';';
						}
						src[k] = '})();';
						moduleDef.src += src.join('');
					}
					execModuleDef(newContext, moduleDef);
					modules[path] = newContext.exports;
				}
				
				importStack.pop();
			
				var module = modules[path];
			
				// return the module if we're only importing one module
				if (numImports == 1) { retVal = module; }
			
				if (!opts.dontExport) {
					// add the module to the current context
					if (item.as) {
						// remove trailing/leading dots
						var as = item.as.match(/^\.*(.*?)\.*$/)[1],
							segments = as.split('.'),
							kMax = segments.length - 1,
							c = exportInto;
				
						// build the object in the context
						for(var k = 0; k < kMax; ++k) {
							var segment = segments[k];
							if (!segment) continue;
							if (!c[segment]) { c[segment] = {}; }
							c = c[segment];
						}
					
						c[segments[kMax]] = module;
				
						// there can be multiple module imports with this syntax (import foo, bar)
						if (numImports > 1) {
							retVal[as] = module;
						}
					} else if(item['import']) {
						// there can only be one module import with this syntax 
						// (from foo import bar), so retVal will already be set here
						if(item['import']['*']) {
							for(var k in modules[path]) { exportInto[k] = module[k]; }
						} else {
							try {
								for(var k in item['import']) { exportInto[item['import'][k]] = module[k]; }
							} catch(e) {
								ENV.log('module: ', modules);
								throw e;
							}
						}
					}
				}
			}
		
			return retVal;
		}
	
		// DEFINE SYNTAX FOR JSIO('cmd')
	
		// from myPackage import myFunc
		// external myPackage import myFunc
		jsio.addCmd(function(context, request, opts, imports) {
			var match = request.match(/^\s*(from|external)\s+([\w.$]+)\s+(import|grab)\s+(.*)$/);
			if(match) {
				imports.push({
					from: match[2],
					dontAddBase: match[1] == 'external',
					dontUseExports: match[3] == 'grab' || match[1] == 'external',
					'import': {}
				});
			
				match[4].replace(/\s*([\w.$*]+)(?:\s+as\s+([\w.$]+))?/g, function(_, item, as) {
					imports[0]['import'][item] = as || item;
				});
				return true;
			}
		});

		// import myPackage
		jsio.addCmd(function(context, request, opts, imports) {
			var match = request.match(/^\s*import\s+(.*)$/);
			if (match) {
				match[1].replace(/\s*([\w.$]+)(?:\s+as\s+([\w.$]+))?,?/g, function(_, fullPath, as) {
					imports.push(
						as ? {
							from: fullPath,
							as: as
						} : {
							from: fullPath,
							as: fullPath
						});
				});
				return true;
			}
		});

		// CommonJS syntax
		jsio.addCmd(function(context, request, opts, imports) {
		
			//		./../b -> ..b
			// 		../../b -> ...b
			// 		../b -> ..b
			// 		./b -> .b
		
			var match = request.match(/^\s*[\w.0-9$\/]+\s*$/);
			if (match) {
			
				var req = util.resolveRelativePath(match[0]),
					isRelative = req.charAt(0) == '.';
			
				req = req	
					// .replace(/^\//, '') // remove any leading slash
					.replace(/\.\.\//g, '.') // replace relative path indicators with dots
					.replace(/\.\//g, '')
					.replace(/\//g, '.'); // any remaining slashes are path separators

				imports[0] = { from: (isRelative ? '.' : '') + req };
				return true;
			}
		});
	
		jsio.install = function(){
			jsio('from base import *');
			GLOBAL['logger'] = logging.get('jsiocore');
		};
	
		jsio.clone = function() {
			var copy = jsio.__init__(jsio);
			if (ENV.name == 'browser') { window.jsio = jsio; }
			return copy;
		}

		return jsio;
	}
	jsio = init();
})();
jsio.path.set(["./"]);jsio.path.cache={"preprocessors":"./","base":"./","std":"./","net":"./","lib":"./","util":"./"};jsio("import .Orbited")
