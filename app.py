# -*- coding: utf-8 -*-

import base64
import os
import os.path
import urllib
import hmac
import json
import hashlib
from base64 import urlsafe_b64decode, urlsafe_b64encode

import requests
from flask import Flask, request, redirect, render_template, url_for, session
from flask_sqlalchemy import SQLAlchemy

import datetime
from networkx.readwrite import json_graph
import math
import networkx as nx
import psycopg2
import time

FB_APP_ID = os.environ.get('FACEBOOK_APP_ID')
FB_APP_SECRET = os.environ.get('FACEBOOK_SECRET')
FB_APP_NAME = 'Friend Constellation'
SQLALCHEMY_DATABASE_URI = os.environ.get('SQLALCHEMY_DATABASE_URI')
requests = requests.session()


def oauth_login_url(preserve_path=True, next_url=None):
	fb_login_uri = ("https://www.facebook.com/dialog/oauth"
					"?client_id=%s&redirect_uri=%s" %
					(app.config['FB_APP_ID'], get_home()))

	if app.config['FBAPI_SCOPE']:
		fb_login_uri += "&scope=%s" % ",".join(app.config['FBAPI_SCOPE'])
	return fb_login_uri


def simple_dict_serialisation(params):
	return "&".join(map(lambda k: "%s=%s" % (k, params[k]), params.keys()))


def base64_url_encode(data):
	return base64.urlsafe_b64encode(data).rstrip('=')


def fbapi_get_string(path,
	domain=u'graph', params=None, access_token=None,
	encode_func=urllib.urlencode):
	"""Make an API call"""

	if not params:
		params = {}
	params[u'method'] = u'GET'
	if access_token:
		params[u'access_token'] = access_token

	for k, v in params.iteritems():
		if hasattr(v, 'encode'):
			params[k] = v.encode('utf-8')

	url = u'https://' + domain + u'.facebook.com' + path
	params_encoded = encode_func(params)
	url = url + params_encoded
	result = requests.get(url).content

	return result


def fbapi_auth(code):
	params = {'client_id': app.config['FB_APP_ID'],
			  'redirect_uri': get_home(),
			  'client_secret': app.config['FB_APP_SECRET'],
			  'code': code}

	result = fbapi_get_string(path=u"/oauth/access_token?", params=params,
							  encode_func=simple_dict_serialisation)
	pairs = result.split("&", 1)
	result_dict = {}
	for pair in pairs:
		(key, value) = pair.split("=")
		result_dict[key] = value
	return (result_dict["access_token"], result_dict["expires"])


def fbapi_get_application_access_token(id):
	token = fbapi_get_string(
		path=u"/oauth/access_token",
		params=dict(grant_type=u'client_credentials', client_id=id,
					client_secret=app.config['FB_APP_SECRET']),
		domain=u'graph')

	token = token.split('=')[-1]
	if not str(id) in token:
		print 'Token mismatch: %s not in %s' % (id, token)
	return token


def fql(fql, token, args=None):
	if not args:
		args = {}

	args["query"], args["format"], args["access_token"] = fql, "json", token

	url = "https://api.facebook.com/method/fql.query"

	r = requests.get(url, params=args)
	return json.loads(r.content)


def fb_call(call, args=None):
	url = "https://graph.facebook.com/{0}".format(call)
	r = requests.get(url, params=args)
	return json.loads(r.content)


app = Flask(__name__)
app.secret_key = FB_APP_SECRET
app.config.from_object(__name__)
app.config.from_object('conf.Config')
db = SQLAlchemy(app)

class User(db.Model):
	__tablename__ = 'fbc_user'
	id = db.Column(db.String(128), primary_key=True)
	name = db.Column(db.String(128))
	username = db.Column(db.String(128))
	link = db.Column(db.String(128))
	access_token = db.Column(db.String(128))
	charts = db.relationship('Chart', backref='user', lazy='dynamic')

	def __init__(self, id):
		self.id = id

	def __repr__(self):
		return '<User %r>' % self.id

class Chart(db.Model):
	__tablename__ = 'fbc_chart'
	id = db.Column(db.Integer, primary_key=True)
	user_id = db.Column(db.String(128), db.ForeignKey('fbc_user.id'))
	nodes = db.Column(db.LargeBinary)
	graph_hash = db.Column(db.String(64))
	generated_date = db.Column(db.DateTime)

	def __init__(self, user_id, nodes, graph_hash, generated_date):
		self.user_id = user_id
		self.nodes = nodes
		self.graph_hash = graph_hash
		self.generated_date = generated_date

	def __repr__(self):
		return '<Chart %r>' % self.id


def get_home():
	return 'https://' + request.host + '/'


def get_token():

	if 'access_token' in session:
		print "Using saved session token."
		return session['access_token']

	if request.args.get('code', None):
		return fbapi_auth(request.args.get('code'))[0]

	cookie_key = 'fbsr_{0}'.format(FB_APP_ID)

	if cookie_key in request.cookies:

		c = request.cookies.get(cookie_key)
		encoded_data = c.split('.', 2)

		sig = encoded_data[0]
		data = json.loads(urlsafe_b64decode(str(encoded_data[1]) +
			(64-len(encoded_data[1])%64)*"="))

		if not data['algorithm'].upper() == 'HMAC-SHA256':
			raise ValueError('unknown algorithm {0}'.format(data['algorithm']))

		h = hmac.new(FB_APP_SECRET, digestmod=hashlib.sha256)
		h.update(encoded_data[1])
		expected_sig = urlsafe_b64encode(h.digest()).replace('=', '')

		if sig != expected_sig:
			raise ValueError('bad signature')

		code =  data['code']

		params = {
			'client_id': FB_APP_ID,
			'client_secret': FB_APP_SECRET,
			'redirect_uri': '',
			'code': data['code']
		}

		from urlparse import parse_qs
		r = requests.get('https://graph.facebook.com/oauth/access_token', params=params)
		token = parse_qs(r.content).get('access_token')
		if token:
			token = token[0]
			session['access_token'] = token

		print r.content

		return token


@app.route('/', methods=['GET', 'POST'])
def index():
	access_token = get_token()
	channel_url = url_for('get_channel', _external=True)
	channel_url = channel_url.replace('http:', '').replace('https:', '')

	print "/graph"
	print "Access token: " + str(access_token)

	if access_token:
		me = fb_call('me', args={'access_token': access_token})
		if not me or 'error' in me:
			print me['error']

			if 'code' in me['error'] and me['error']['code'] == 190:
				# Access token expired.
				session.pop('access_token', None)

			return render_template('login.html', app_id=FB_APP_ID, token=access_token, url=request.url, channel_url=channel_url, name=FB_APP_NAME)

		fb_app = fb_call(FB_APP_ID, args={'access_token': access_token})

		return render_template(
			'index.html', app_id=FB_APP_ID, token=access_token, app=fb_app, me=me, name=FB_APP_NAME)
	else:
		return render_template('login.html', app_id=FB_APP_ID, token=access_token, url=request.url, channel_url=channel_url, name=FB_APP_NAME)

@app.route('/graph.json', methods=['GET', 'POST'])
def get_graph_data():
	access_token = get_token()

	print "/graph.json"
	print "Access token: " + str(access_token)

	if access_token:

		me = fb_call('me', args={'access_token': access_token})
		if not me:
			# FIXME: Implement error-handling.
			raise
		elif 'error' in me:
			# FIXME: Implement error-handling.
			raise Exception(me['error']['message'])

		# DEBUG:
		return '{"nodes": [{"id": 1, "data": {"label": "Root"}}], "edges": []}'

		u = User.query.get(me['id'])
		c = u.charts.order_by(Chart.generated_date.desc()).first();

		if c:
			return c.nodes

		else:
			# NOTE: limiting to 1000 users.
			friends = fql("SELECT uid, name, pic_square FROM user WHERE uid IN (SELECT uid2 FROM friend WHERE uid1=me()) LIMIT 1000", access_token)

			g = nx.Graph()
			g.add_nodes_from(map(lambda x: (x['uid'],
				{'id': str(x['uid']), 'name': x.get('name', ''), 'pic_square': x.get('pic_square', '')}),
				friends))

			batchSize = 50
			numFriends = len(friends)
			for i in range(0, int(math.ceil(float(numFriends) / batchSize))):
				batchIds = map(lambda x: str(x['uid']), friends[i * batchSize:(i + 1) * batchSize])
				batch = map(lambda x: {'method': 'GET',
					'relative_url': "me/mutualfriends/{0}".format(x)}, batchIds)

				url = 'https://graph.facebook.com'
				response = requests.post(url,
					params={'access_token': access_token, 'batch': json.dumps(batch)})
				response = json.loads(response.content)

				errors = filter(lambda x: x['code'] != 200, response)
				if len(errors) > 0:
					# FIXME: Implement error-handling.
					return "Got errors: " + json.dumps(errors)
				else:
					response = map(lambda x: map(lambda y: y['id'], json.loads(x['body'])['data']), response)
					for j in range(0, len(response)):
						g.add_edges_from(zip([batchIds[j]] * len(response[j]), response[j]))

				time.sleep(0.1)

			layout = nx.spring_layout(g, 2, None, None, 100, True, 1)
			for nodeId in layout:
				coords = layout[nodeId]
				g.node[nodeId]['x'] = str(coords[0])
				g.node[nodeId]['y'] = str(coords[1])

			response = ('{"nodes": '
				+ json.dumps(map(lambda x: x[1], g.nodes(data=True)))
				+ ', "edges": '
				+ json.dumps(g.edges(data=False)) + '}')

			c = Chart(u.id, response, '', datetime.datetime.now())
			db.session.add(c)
			db.session.commit()

			return response
	else:
		return '{"data": false}'


@app.route('/logout', methods=['GET', 'POST'])
def logout():
	session.pop('access_token', None)
	return redirect('/')

@app.route('/channel.html', methods=['GET', 'POST'])
def get_channel():
	return render_template('channel.html')


@app.route('/close/', methods=['GET', 'POST'])
def close():
	return render_template('close.html')

if __name__ == '__main__':
	port = int(os.environ.get("PORT", 5000))
	if (app.config.get('FB_APP_ID')
		and app.config.get('FB_APP_SECRET')
		and app.config.get('SQLALCHEMY_DATABASE_URI')):
		app.run(host='0.0.0.0', port=port, debug=True)
	else:
		print 'Cannot start application without Facebook App Id and Secret and database URI set'
