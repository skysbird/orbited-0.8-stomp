jsio('from net.protocols.mspp import MSPPStream, MSPPProtocol');
jsio('import std.utf8')

exports.logging = logging;
exports.utf8 = std.utf8
// autodetect host + port!!!
exports.settings = { 'host': 'www.xinwaihui.com', 'port': '80', 'path': '/csp'};

var multiplexer = null;
exports.TCPSocket = Class(MSPPStream, function() {
    this.init = function() {
        this.setEncoding('plain');
        if (multiplexer == null || ('url' in multiplexer)==false) {
            multiplexer = new MSPPProtocol();
                multiplexer.setTransport('csp', {"url": "http://" + exports.settings.host + ":" + exports.settings.port + exports.settings.path,"preferredTransport":"xhr"});
        }
        this.setMultiplexer(multiplexer);
    }
});
