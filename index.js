var queue = require('queue-async');

var postcss = require('postcss');
var postcssUrl = require("postcss-url");
var uglify = require('uglify-js');
var autoprefixer = require('autoprefixer-core');
var csswring = require('csswring');

module.exports = function(raja, opts) {
	if (!opts) opts = {};
	return domAuthorMinify.bind(null, raja, opts);
};

function domAuthorMinify(raja, opts, h, req, res) {
	h.page.run(domTransform, function(err, maps, cb) {
		if (err) return cb(err);
		build(raja, maps, opts, cb);
	});
}

function domTransform(done) {
	function populateMaps(maps, tagName, src, atts, type) {
		var nodes = Array.prototype.slice.call(document.querySelectorAll(tagName));
		nodes.forEach(function(node) {
			var minify = node.hasAttribute('minify');
			if (!minify) return;
			var single = false;
			var dest = node.getAttribute('minify');
			if (!dest) {
				single = true;
				dest = node[src].split('.');
				dest.push('min', dest.pop());
				dest = dest.join('.');
			}
			var map = maps[dest];
			if (!map) {
				var destNode = document.createElement(tagName);
				for (var name in atts) {
					destNode[name] = atts[name];
				}
				destNode[src] = dest;
				node.parentNode.insertBefore(destNode, node);
				map = maps[dest] = {
					list:[],
					url: destNode[src],
					single: single
				};
				for (var name in atts) {
					map[name] = atts[name];
				}
				if (type) map.type = type;
			}
			node.parentNode.removeChild(node);
			if (map.single && map.list.length == 1) {
				throw new Error("cannot automatically name minified files with the same names", dest);
			} else {
				map.list.push(node[src]);
			}
		});
	}
	var maps = {}, err = null;
	try {
		populateMaps(maps, 'script', 'src', {type:'text/javascript', charset:'utf-8'});
		populateMaps(maps, 'link', 'href', {type:'text/css', rel:'stylesheet'});
	} catch(e) {
		err = e;
	}
	done(err, maps);
}

function build(raja, maps, opts, cb) {
	if (Object.keys(maps).length == 0) return cb();
	var q = queue(1);
	for (var path in maps) {
		var map = maps[path];
		var type = map.type;
		var batch = {
			"text/css": batchCss,
			"text/javascript": batchJs
		}[type];
		if (!batch) {
			console.error("Unsupported type in", map);
			continue;
		}
		var resource = raja.create(map.url);
		if (map.charset) type += '; charset=' + map.charset;
		resource.headers = {};
		resource.headers['Content-Type'] = type;
		// not so useful - minified files already are declared as dependencies of the authorUrl
		// if (!resource.parents) resource.parents = {};
		// resource.parents[h.authorUrl] = true;
		q.defer(batch, resource, map.list, opts);
	}
	q.awaitAll(function(err) {
		// do not pass the list of results
		cb(err);
	});
}

function batchCss(resource, list, opts, cb) {
	var q = queue(1);
	var cur;
	list.forEach(function(rurl) {
		q.defer(function(cb) {
			resource.load(rurl, function(err, data) {
				if (err) return cb(err);
				if (Buffer.isBuffer(data)) data = data.toString();
				var parsed = postcss.parse(data, {from: rurl});
				postcssUrl({url: "rebase"})(parsed, {from: rurl, to: resource.url});
				autoprefixer({ browsers: opts.browsers }).postcss(parsed);
				csswring.postcss(parsed);
				if (!cur) cur = parsed;
				else cur.append(parsed);
				cb();
			});
		});
	});
	q.awaitAll(function(err) {
		if (err) return cb(err);
		if (!cur) return cb(new Error("should never happen"));
		resource.data = cur.toResult({to: resource.url}).toString();
		resource.save(cb);
	});
}

function batchJs(resource, list, opts, cb) {
	var q = queue(1);
	var cur = null;
	list.forEach(function(rurl) {
		q.defer(function(cb) {
			resource.load(rurl, function(err, data) {
				if (err) return cb(err);
				if (Buffer.isBuffer(data)) data = data.toString();
				cur = uglify.parse(data, {filename: rurl, toplevel: cur});
				cb();
			});
		});
	});
	q.awaitAll(function(err) {
		if (err) return cb(err);
		cur.figure_out_scope();
		cur.compute_char_frequency();
		cur.mangle_names();

		var source_map = uglify.SourceMap();
		resource.data = cur.print_to_string({source_map: source_map});
		// do something with map
		// var map = source_map.toString();
		resource.save(cb);
	});
}

