'use strict';

var _            = require('lodash'),
    util         = require('util'),
    { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb'),
    { DynamoDB } = require('@aws-sdk/client-dynamodb'),
    Table        = require('./table'),
    Schema       = require('./schema'),
    serializer   = require('./serializer'),
    batch        = require('./batch'),
    Item         = require('./item'),
    createTables = require('./createTables'),
    bunyan       = require('bunyan');

var dynamo = module.exports;

var internals = {};

const marshallOptions = {
  // Whether to automatically convert empty strings, blobs, and sets to `null`.
  convertEmptyValues: false,
  // Whether to remove undefined values while marshalling.
  removeUndefinedValues: true,
  // Whether to convert typeof object to map attribute.
  convertClassInstanceToMap: false,
};

const unmarshallOptions = {
  // Whether to return numbers as a string instead of converting them to native JavaScript numbers.
  wrapNumbers: false,
};
const translateConfig = {
  marshallOptions,
  unmarshallOptions
};

dynamo.log = bunyan.createLogger({
  name: 'dynamo',
  serializers : {err: bunyan.stdSerializers.err},
  level : bunyan.FATAL
});

dynamo.dynamoDriver = internals.dynamoDriver = function (driver) {
  internals.dynamodb = driver;
  const docClient = internals.loadDocClient(driver);
  internals.updateDynamoDBDocClientForAllModels(docClient, driver);
  return internals.dynamodb;
};

dynamo.documentClient = internals.documentClient = function (docClient) {
  if(docClient) {
    internals.docClient = docClient;
    internals.dynamodb = docClient.service;
    internals.updateDynamoDBDocClientForAllModels(docClient, internals.dynamodb);
  } else {
    internals.loadDocClient();
  }

  return internals.docClient;
};

internals.updateDynamoDBDocClientForAllModels = function (docClient, dynamoClient) {
  _.each(dynamo.models, function (model) {
    model.config({docClient, dynamoClient});
  });
};

internals.loadDocClient = function () {
  internals.docClient = internals.docClient || DynamoDBDocumentClient.from(internals.loadDynamoClient(), translateConfig);
  return internals.docClient;
};

internals.loadDynamoClient = function () {
  internals.dynamodb = internals.dynamodb || new DynamoDB();
  return internals.dynamodb;
};

internals.compileModel = function (name, schema) {

  // extremly simple table names
  var tableName = name.toLowerCase() + 's';

  var log = dynamo.log.child({model: name});

  var table = new Table(tableName, schema, serializer, internals.loadDocClient(), internals.loadDynamoClient(), log);

  var Model = function (attrs) {
    Item.call(this, attrs, table);
  };

  util.inherits(Model, Item);

  Model.get          = _.bind(table.get, table);
  Model.create       = _.bind(table.create, table);
  Model.update       = _.bind(table.update, table);
  Model.destroy      = _.bind(table.destroy, table);
  Model.query        = _.bind(table.query, table);
  Model.scan         = _.bind(table.scan, table);
  Model.parallelScan = _.bind(table.parallelScan, table);

  Model.getItems = batch(table, serializer).getItems;
  Model.batchGetItems = batch(table, serializer).getItems;

  // table ddl methods
  Model.createTable        = _.bind(table.createTable, table);
  Model.updateTable        = _.bind(table.updateTable, table);
  Model.describeTable      = _.bind(table.describeTable, table);
  Model.deleteTable        = _.bind(table.deleteTable, table);

  // async version of ddl methods
  Model.createTableAsync   = _.bind(table.createTableAsync, table);
  Model.updateTableAsync   = _.bind(table.updateTableAsync, table);
  Model.describeTableAsync = _.bind(table.describeTableAsync, table);
  Model.deleteTableAsync   = _.bind(table.deleteTableAsync, table);

  Model.tableName          = _.bind(table.tableName, table);

  table.itemFactory = Model;

  Model.log = log;

  // hooks
  Model.after  = _.bind(table.after, table);
  Model.before = _.bind(table.before, table);

  /* jshint camelcase:false */
  Model.__defineGetter__('docClient', function(){
    return table.docClient;
  });

  Model.__defineGetter__('dynamoClient', function(){
    return table.dynamoClient;
  });

  Model.config = function(config) {
    config = config || {};

    if(config.tableName) {
      table.config.name = config.tableName;
    }

    if (config.docClient) {
      table.docClient = config.docClient;
    }
    if (config.dynamoClient) {
      table.docClient = DynamoDBDocumentClient.from(config.dynamoClient, translateConfig);
      table.dynamoClient = config.dynamoClient;
    }

    return table.config;
  };

  return dynamo.model(name, Model);
};

internals.addModel = function (name, model) {
  dynamo.models[name] = model;

  return dynamo.models[name];
};

dynamo.reset = function () {
  dynamo.models = {};
};

dynamo.Set = function () {
  return internals.docClient.createSet.apply(internals.docClient, arguments);
};

dynamo.define = function (modelName, config) {
  if(_.isFunction(config)) {
    throw new Error('define no longer accepts schema callback, migrate to new api');
  }

  var schema = new Schema(config);

  var compiledTable = internals.compileModel(modelName, schema);

  return compiledTable;
};

dynamo.model = function(name, model) {
  if(model) {
    internals.addModel(name, model);
  }

  return dynamo.models[name] || null;
};

dynamo.createTables = function (options, callback) {
  if (typeof options === 'function' && !callback) {
    callback = options;
    options = {};
  }

  var promise;
  if (!callback && Promise) {
    promise = new Promise(function (resolve, reject) {
      callback = function (err, results) {
        err ? reject(err) : resolve(results);
      };
    });
  }

  callback = callback || _.noop;
  options = options || {};

  createTables(dynamo.models, options, callback);

  return promise;
};

dynamo.types = Schema.types;

dynamo.reset();
