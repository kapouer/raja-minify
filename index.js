var queue = require('queue-async');

var postcss = require('postcss');
var postcssUrl = require("postcss-url");
var uglify = require('uglify-js');
var autoprefixer = require('autoprefixer-core');
var csswring = require('csswring');
var debug = require('debug')('raja:minify');


// require('raja-minify')(raja, opts);
module.exports = function(raja, opts) {
	if (!opts) opts = {};
	if (opts.minify == null) opts.minify = true;
	if (raja.proxies.dom) {
		raja.proxies.dom.Dom.author(domAuthorMinify.bind(null, raja, opts), 'after');
	}
	raja.builders.minify = buildResource.bind(null, opts);
};

function domAuthorMinify(raja, opts, page, resource) {
	debug('minify on', resource.key);
	page.when('ready', function(cb) {
		this.run(domTransform, !!opts.minify, function(err, groups) {
			if (err) return cb(err);
			build(raja, groups, opts, cb);
		});
	});
}

function domTransform(minify, done) {
	function renameTo(src, to) {
		if (src != to) {
			if (to[0] == '../' || to[0] == './' || to[0] != '/') {
				// remove last component from src
				src = src.split('/');
				src.pop();
				src.push(to);
				to = src.join('/');
			}
		}
		var split = to.split('.');
		split.splice(-1, 0, 'min');
		to = split.join('.');
		return to;
	}
	function getGroups(selector, att, mime) {
		var groups = [];
		var nodes = Array.prototype.slice.call(document.querySelectorAll(selector));
		var resource;
		nodes.forEach(function(node) {
			if (!node.hasAttribute(att) || !node.getAttribute(att)) return;
			var single = !node.hasAttribute('to');
			if (single && !minify) return;
			// ignore foreign url
			var url = new URL(node[att]);
			if (url.host != document.location.host) return;
			if (!resource || single) {
				resource = {nodes: []};
				groups.push(resource);
			}
			resource.nodes.push({node: node, href: url.href});
			if (node.getAttribute('to') || single) resource = null;
		});
		groups.forEach(function(resource) {
			var resources = {};
			var last = resource.nodes.slice(-1).pop();
			resource.nodes.forEach(function(obj) {
				resources[obj.href] = true;
				var node = obj.node;
				if (node != last.node) {
					var next = node.nextSibling;
					while (next && next.nodeType == 3) {
						next.parentNode.removeChild(next);
						next = next.nextSibling;
					}
					node.parentNode.removeChild(node);
				} else {
					node[att] = renameTo(node.getAttribute(att), node.getAttribute('to') || node.getAttribute(att));
					resource.url = (new URL(node[att])).href;
					node.removeAttribute('to');
				}
			});
			delete resource.nodes;
			resource.resources = resources;
			resource.headers = {'Content-Type': mime};
		});
		return groups;
	}

	var scripts = getGroups('script', 'src', 'text/javascript');
	var styles = getGroups('link[rel="stylesheet"]', 'href', 'text/css');
	done(null, scripts.concat(styles));
}

function build(raja, groups, opts, cb) {
	if (groups.length == 0) return cb();
	var q = queue();
	var upsert = raja.upsert.bind(raja);
	var ns = raja.opts.namespace;
	groups.forEach(function(resource) {
		resource.builder = 'minify';
		resource.headers['X-Raja'] = ns;
		var resources = {};
		for (var url in resource.resources) {
			resources[raja.reqkey({url: url, headers: {'X-Raja': ns}})] = {headers: {'X-Raja': ns}};
		}
		resource.resources = resources;
		q.defer(upsert, resource);
	});
	q.awaitAll(function(err, resources) {
		if (err) return cb(err);
		q = queue();
		resources.forEach(function(resource) {
			q.defer(buildResource, opts, resource);
		});
		q.awaitAll(function(err) {
			cb(err);
		});
	});
}

function buildResource(opts, resource, cb) {
	if (resource.valid) return cb();
	if (resource.is("text/css")) {
		batch(resource, processCss, resultCss, opts, cb);
	} else if (!opts.minify) {
		batch(resource, process, result, opts, cb);
	} else if (resource.is("text/javascript")) {
		batch(resource, processJs, resultJs, opts, cb);
	} else {
		console.log(resource)
		cb(new Error("raja-minify cannot process resource " + resource.url));
	}
}

function process(to, url, data, ref) {
	if (Buffer.isBuffer(data)) data = data.toString();
	if (!ref.root) ref.root = [];
	ref.root.push(data);
}

function result(to, root, opts, cb) {
	cb(null, root.join("\n"));
}

function processCss(to, url, data, ref) {
	if (Buffer.isBuffer(data)) data = data.toString();
	var root = postcss.parse(data, {from: url, safe: true});
	if (!ref.root) ref.root = root;
	else ref.root.push(root);
}

function resultCss(to, root, opts, cb) {
	var plugins = opts.postcssPlugins || [];
	plugins.push(postcssUrl({url: "rebase"}));
	plugins.push(autoprefixer({ browsers: opts.browsers }));
	if (opts.minify) plugins.push(csswring({preserveHacks: true}));
	postcss(plugins).process(root, {to: to}).then(function(result) {
		cb(null, result.css);
	}, function(err) {
		cb(err);
	});
}

function processJs(to, url, data, ref, cb) {
	if (Buffer.isBuffer(data)) data = data.toString();
	var root = uglify.parse(data, {filename: url, toplevel: ref.root});
	if (!ref.root) ref.root = root;
}

function resultJs(to, root, opts, cb) {
	root.figure_out_scope();
	root.compute_char_frequency();
	root.mangle_names();
	var source_map = uglify.SourceMap();
	cb(null, root.print_to_string({source_map: source_map}));
}

function batch(resource, process, result, opts, cb) {
	var q = queue();
	var load = resource.load.bind(resource);
	Object.keys(resource.resources).forEach(function(url) {
		debug("minify is loading", url);
		q.defer(load, url, {headers: {'X-Raja':resource.raja.opts.namespace}});
	});
	q.awaitAll(function(err, resources) {
		if (err) return cb(err);
		var ref = {};
		resources.forEach(function(child) {
			process(resource.url, child.url, child.data, ref);
		});
		result(resource.url, ref.root, opts, function(err, data) {
			if (err) return cb(err);
			resource.data = data;
			debug('minified', resource.url);
			resource.valid = true;
			resource.save(cb);
		});
	});
}

