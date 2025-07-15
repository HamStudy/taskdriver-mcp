import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { 
  AuthenticatedRequest,
  Session,
  Project,
  ApiResponse
} from './types/index.js';
import { TaskDriverConfig } from './config/types.js';
import { createStorageProvider } from './storage/index.js';
import { 
  ProjectService,
  TaskTypeService, 
  TaskService,
  AgentService,
  LeaseService,
  SessionService
} from './services/index.js';
import { validate, isValidationError } from './utils/validation.js';
import { createProjectSchema, createTaskTypeSchema, createTaskSchema, createAgentSchema } from './utils/validation.js';
import { logger, logHttpRequest, createOperationLogger } from './utils/logger.js';
import { metrics, TaskDriverMetrics } from './utils/metrics.js';

// Extend Express Request to include session info
declare global {
  namespace Express {
    interface Request {
      session?: Session;
      project?: Project;
      correlationId?: string;
    }
  }
}

/**
 * HTTP server for TaskDriver
 * Provides REST API access with session-based authentication
 */
export class TaskDriverHttpServer {
  private app: express.Application;
  private server: any;
  private config: TaskDriverConfig;
  private storage: any;
  private services: {
    project: ProjectService;
    taskType: TaskTypeService;
    task: TaskService;
    agent: AgentService;
    lease: LeaseService;
    session: SessionService;
  } | undefined;

  constructor(config: TaskDriverConfig) {
    this.config = config;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  async initialize(): Promise<void> {
    // Initialize storage
    this.storage = createStorageProvider(this.config);
    await this.storage.initialize();

    // Initialize services
    this.services = {
      project: new ProjectService(this.storage),
      taskType: new TaskTypeService(this.storage, null as any), // Will be set after
      task: new TaskService(this.storage, null as any, null as any), // Will be set after
      agent: new AgentService(this.storage, null as any, null as any), // Will be set after
      lease: new LeaseService(this.storage),
      session: new SessionService(this.storage, null as any, null as any, this.config.security.sessionTimeout / 1000)
    };

    // Set up service dependencies
    this.services.taskType = new TaskTypeService(this.storage, this.services.project);
    this.services.task = new TaskService(this.storage, this.services.project, this.services.taskType);
    this.services.agent = new AgentService(this.storage, this.services.project, this.services.task);
    this.services.session = new SessionService(
      this.storage, 
      this.services.agent, 
      this.services.project, 
      this.config.security.sessionTimeout / 1000
    );
  }

  async start(): Promise<void> {
    try {
      await this.initialize();
      logger.info('TaskDriver HTTP server initialized successfully', {
        host: this.config.server.host,
        port: this.config.server.port
      });
      
      return new Promise((resolve) => {
        this.server = this.app.listen(this.config.server.port, this.config.server.host, () => {
          logger.info('TaskDriver HTTP server started successfully', {
            host: this.config.server.host,
            port: this.config.server.port,
            url: `http://${this.config.server.host}:${this.config.server.port}`
          });
          metrics.setGauge('taskdriver_server_started', 1);
          resolve();
        });
      });
    } catch (error) {
      logger.error('Failed to start TaskDriver HTTP server', { 
        host: this.config.server.host, 
        port: this.config.server.port 
      }, error as Error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      logger.info('Stopping TaskDriver HTTP server...');
      
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server.close(() => {
            logger.info('HTTP server stopped successfully');
            resolve();
          });
        });
      }
      
      if (this.storage) {
        await this.storage.close();
        logger.info('Storage connection closed successfully');
      }
      
      metrics.setGauge('taskdriver_server_started', 0);
      logger.info('TaskDriver HTTP server shutdown complete');
    } catch (error) {
      logger.error('Error during server shutdown', {}, error as Error);
      throw error;
    }
  }

  private setupMiddleware(): void {
    // Request logging middleware - placed first to catch all requests
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      const correlationId = req.headers['x-correlation-id'] as string || uuidv4();
      
      req.correlationId = correlationId;
      res.setHeader('x-correlation-id', correlationId);
      
      // Log request start
      logger.info(`HTTP ${req.method} ${req.path} started`, {
        correlationId,
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection.remoteAddress
      });
      
      // Increment metrics
      metrics.incrementCounter('taskdriver_http_requests_total', { 
        method: req.method, 
        path: req.path 
      });
      metrics.incrementGauge('taskdriver_http_requests_in_flight');
      
      // Override res.end to log response
      const originalEnd = res.end.bind(res);
      res.end = function(chunk?: any, encoding?: any, cb?: any) {
        const duration = Date.now() - startTime;
        
        // Log HTTP request completion
        logHttpRequest(req.method, req.path, res.statusCode, duration, {
          correlationId,
          userAgent: req.headers['user-agent'] as string,
          ip: req.ip || req.connection.remoteAddress as string
        });
        
        // Update metrics
        metrics.observeHistogram('taskdriver_http_request_duration_seconds', duration / 1000, {
          method: req.method,
          path: req.path,
          status: res.statusCode.toString()
        });
        metrics.decrementGauge('taskdriver_http_requests_in_flight');
        
        return originalEnd(chunk, encoding, cb);
      };
      
      next();
    });

    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // limit each IP to 1000 requests per windowMs
      message: 'Too many requests from this IP, please try again later.'
    });
    this.app.use('/api/', limiter);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Correlation ID middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      req.correlationId = req.headers['x-correlation-id'] as string || uuidv4();
      res.setHeader('X-Correlation-ID', req.correlationId);
      next();
    });

    // Request logging middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms [${req.correlationId}]`);
      });
      
      next();
    });
  }

  private setupRoutes(): void {
    // Health check and monitoring endpoints
    this.app.get('/health', this.handleHealthCheck.bind(this));
    this.app.get('/metrics', this.handleMetrics.bind(this));
    this.app.get('/metrics/json', this.handleMetricsJson.bind(this));
    
    // API routes
    this.app.use('/api', this.createApiRouter());
    
    // 404 handler
    this.app.use((req: Request, res: Response) => {
      logger.warn('Route not found', {
        correlationId: req.correlationId,
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection.remoteAddress
      });
      this.sendError(res, 'Not Found', 404, req.correlationId);
    });

    // Global error handler - CRITICAL: This catches ALL unhandled exceptions
    this.app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
      // Log the full exception details - this is crucial for debugging
      logger.error('Unhandled exception in HTTP request', {
        correlationId: req.correlationId,
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection.remoteAddress,
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack
      }, error);
      
      // Update error metrics
      metrics.incrementCounter('taskdriver_http_errors_total', {
        method: req.method,
        path: req.path,
        error_type: error.name
      });
      
      // Never expose internal error details to clients in production
      const isProduction = process.env.NODE_ENV === 'production';
      const errorMessage = isProduction ? 'Internal Server Error' : error.message;
      
      this.sendError(res, errorMessage, 500, req.correlationId);
    });
  }

  private createApiRouter(): express.Router {
    const router = express.Router();

    // Authentication routes (no auth required)
    router.post('/auth/login', this.handleLogin.bind(this));
    router.post('/auth/logout', this.authenticateSession.bind(this), this.handleLogout.bind(this));

    // Apply authentication middleware to all other routes
    router.use(this.authenticateSession.bind(this));

    // Project routes
    router.get('/projects', this.handleListProjects.bind(this));
    router.post('/projects', this.handleCreateProject.bind(this));
    router.get('/projects/:projectId', this.handleGetProject.bind(this));
    router.put('/projects/:projectId', this.handleUpdateProject.bind(this));
    router.delete('/projects/:projectId', this.handleDeleteProject.bind(this));
    router.get('/projects/:projectId/stats', this.handleGetProjectStats.bind(this));

    // Task type routes
    router.get('/projects/:projectId/task-types', this.handleListTaskTypes.bind(this));
    router.post('/projects/:projectId/task-types', this.handleCreateTaskType.bind(this));
    router.get('/task-types/:typeId', this.handleGetTaskType.bind(this));
    router.put('/task-types/:typeId', this.handleUpdateTaskType.bind(this));
    router.delete('/task-types/:typeId', this.handleDeleteTaskType.bind(this));

    // Task routes
    router.get('/projects/:projectId/tasks', this.handleListTasks.bind(this));
    router.post('/projects/:projectId/tasks', this.handleCreateTask.bind(this));
    router.post('/projects/:projectId/tasks/bulk', this.handleCreateTasksBulk.bind(this));
    router.get('/tasks/:taskId', this.handleGetTask.bind(this));
    router.put('/tasks/:taskId', this.handleUpdateTask.bind(this));
    router.delete('/tasks/:taskId', this.handleDeleteTask.bind(this));

    // Agent routes
    router.get('/projects/:projectId/agents', this.handleListAgents.bind(this));
    router.post('/projects/:projectId/agents', this.handleCreateAgent.bind(this));
    router.get('/agents/:agentId', this.handleGetAgent.bind(this));
    router.put('/agents/:agentId', this.handleUpdateAgent.bind(this));
    router.delete('/agents/:agentId', this.handleDeleteAgent.bind(this));

    // Task operations
    router.post('/agents/:agentName/next-task', this.handleGetNextTask.bind(this));
    router.post('/tasks/:taskId/complete', this.handleCompleteTask.bind(this));
    router.post('/tasks/:taskId/fail', this.handleFailTask.bind(this));

    // Lease management
    router.post('/projects/:projectId/cleanup-leases', this.handleCleanupLeases.bind(this));
    router.post('/tasks/:taskId/extend-lease', this.handleExtendLease.bind(this));

    // Session management
    router.get('/auth/session', this.handleGetSession.bind(this));
    router.put('/auth/session', this.handleUpdateSession.bind(this));

    return router;
  }

  // Monitoring endpoint handlers
  private async handleMetrics(req: Request, res: Response): Promise<void> {
    try {
      const prometheusMetrics = metrics.getPrometheusMetrics();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(prometheusMetrics);
    } catch (error) {
      logger.error('Failed to generate Prometheus metrics', {
        correlationId: req.correlationId
      }, error as Error);
      this.sendError(res, 'Failed to generate metrics', 500, req.correlationId);
    }
  }

  private async handleMetricsJson(req: Request, res: Response): Promise<void> {
    try {
      const jsonMetrics = {
        ...metrics.getJsonMetrics(),
        system: metrics.getSystemMetrics()
      };
      this.sendSuccess(res, jsonMetrics);
    } catch (error) {
      logger.error('Failed to generate JSON metrics', {
        correlationId: req.correlationId
      }, error as Error);
      this.sendError(res, 'Failed to generate metrics', 500, req.correlationId);
    }
  }

  // Middleware for session authentication
  private async authenticateSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.warn('Authentication failed - missing or invalid authorization header', {
          correlationId: req.correlationId,
          method: req.method,
          path: req.path,
          hasAuthHeader: !!authHeader,
          authHeaderFormat: authHeader ? 'invalid' : 'missing'
        });
        this.sendError(res, 'Authentication required', 401, req.correlationId);
        return;
      }

      const sessionToken = authHeader.substring(7);
      const sessionInfo = await this.services!.session.validateSession(sessionToken);
      
      if (!sessionInfo) {
        logger.warn('Authentication failed - invalid or expired session token', {
          correlationId: req.correlationId,
          method: req.method,
          path: req.path,
          tokenLength: sessionToken.length
        });
        this.sendError(res, 'Invalid or expired session', 401, req.correlationId);
        return;
      }

      // Attach session info to request
      req.session = sessionInfo.session;
      req.project = sessionInfo.project;
      // Note: agent info is available in sessionInfo.agent but not attached to req in lease-based model

      logger.debug('Authentication successful', {
        correlationId: req.correlationId,
        sessionId: sessionInfo.session.id,
        agentName: sessionInfo.agent?.name || sessionInfo.session.agentName,
        projectId: sessionInfo.project.id
      });

      next();
    } catch (error) {
      logger.error('Unexpected error during authentication', {
        correlationId: req.correlationId,
        method: req.method,
        path: req.path
      }, error as Error);
      this.sendError(res, 'Authentication failed', 401, req.correlationId);
    }
  }

  // Route handlers
  private async handleHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      logger.debug('Health check requested', {
        correlationId: req.correlationId
      });
      
      const health = await this.storage.healthCheck();
      const responseData = {
        status: health.healthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        storage: health
      };
      
      if (!health.healthy) {
        logger.warn('Health check failed - storage unhealthy', {
          correlationId: req.correlationId,
          storage: health
        });
      }
      
      res.json(responseData);
    } catch (error) {
      logger.error('Health check endpoint failed with exception', {
        correlationId: req.correlationId
      }, error as Error);
      
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Storage health check failed'
      });
    }
  }

  private async handleLogin(req: Request, res: Response): Promise<void> {
    try {
      const { 
        agentName, 
        projectId, 
        resumeExisting = false, 
        allowMultipleSessions = false 
      } = req.body;
      
      logger.info('Login attempt', {
        correlationId: req.correlationId,
        agentName,
        projectId,
        resumeExisting,
        allowMultipleSessions
      });
      
      if (!agentName || !projectId) {
        logger.warn('Login failed - missing required parameters', {
          correlationId: req.correlationId,
          hasAgentName: !!agentName,
          hasProjectId: !!projectId
        });
        this.sendError(res, 'agentName and projectId are required', 400, req.correlationId);
        return;
      }

      const result = await this.services!.session.createSession(agentName, projectId, {
        resumeExisting,
        allowMultipleSessions
      });
      
      logger.info('Login successful', {
        correlationId: req.correlationId,
        sessionId: result.session.id,
        agentName,
        projectId,
        resumed: result.resumed || false
      });
      
      // Update session metrics
      metrics.incrementCounter('taskdriver_sessions_created_total');
      metrics.incrementGauge('taskdriver_sessions_active');
      
      this.sendSuccess(res, {
        sessionToken: result.sessionToken,
        session: result.session,
        resumed: result.resumed || false
      });
    } catch (error: any) {
      logger.error('Login failed with exception', {
        correlationId: req.correlationId,
        agentName: req.body?.agentName,
        projectId: req.body?.projectId
      }, error);
      
      // Update error metrics
      metrics.incrementCounter('taskdriver_login_errors_total', {
        error_type: error.name || 'unknown'
      });
      
      this.sendError(res, error.message, 400, req.correlationId);
    }
  }

  private async handleLogout(req: Request, res: Response): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const sessionToken = authHeader.substring(7);
        await this.services!.session.destroySession(sessionToken);
      }
      
      this.sendSuccess(res, { message: 'Logged out successfully' });
    } catch (error) {
      this.sendSuccess(res, { message: 'Logged out successfully' }); // Always succeed
    }
  }

  // Project handlers
  private async handleListProjects(req: Request, res: Response): Promise<void> {
    try {
      const includeClosed = req.query.includeClosed === 'true';
      const projects = await this.services!.project.listProjects(includeClosed);
      this.sendSuccess(res, projects);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleCreateProject(req: Request, res: Response): Promise<void> {
    try {
      const input = validate(createProjectSchema, req.body);
      const project = await this.services!.project.createProject(input);
      this.sendSuccess(res, project, 201);
    } catch (error: any) {
      if (isValidationError(error)) {
        this.sendError(res, error.message, 400);
      } else {
        this.sendError(res, error.message);
      }
    }
  }

  private async handleGetProject(req: Request, res: Response): Promise<void> {
    try {
      const projectId = this.validateRequiredParam(req.params.projectId, 'Project ID');
      const project = await this.services!.project.getProject(projectId);
      if (!project) {
        this.sendError(res, 'Project not found', 404);
        return;
      }
      this.sendSuccess(res, project);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleUpdateProject(req: Request, res: Response): Promise<void> {
    try {
      const projectId = this.validateRequiredParam(req.params.projectId, 'Project ID');
      const project = await this.services!.project.updateProject(projectId, req.body);
      this.sendSuccess(res, project);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleDeleteProject(req: Request, res: Response): Promise<void> {
    try {
      const projectId = this.validateRequiredParam(req.params.projectId, 'Project ID');
      await this.services!.project.deleteProject(projectId);
      this.sendSuccess(res, { message: 'Project deleted successfully' });
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleGetProjectStats(req: Request, res: Response): Promise<void> {
    try {
      const projectId = this.validateRequiredParam(req.params.projectId, 'Project ID');
      const stats = await this.services!.project.getProjectStatus(projectId);
      this.sendSuccess(res, stats);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleListTaskTypes(req: Request, res: Response): Promise<void> {
    try {
      const projectId = this.validateRequiredParam(req.params.projectId, 'Project ID');
      const taskTypes = await this.services!.taskType.listTaskTypes(projectId);
      this.sendSuccess(res, taskTypes);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleCreateTaskType(req: Request, res: Response): Promise<void> {
    try {
      const taskType = await this.services!.taskType.createTaskType({
        ...req.body,
        projectId: req.params.projectId
      });
      this.sendSuccess(res, taskType, 201);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleGetTaskType(req: Request, res: Response): Promise<void> {
    try {
      const typeId = this.validateRequiredParam(req.params.typeId, 'Type ID');
      const taskType = await this.services!.taskType.getTaskType(typeId);
      if (!taskType) {
        this.sendError(res, 'Task type not found', 404);
        return;
      }
      this.sendSuccess(res, taskType);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleUpdateTaskType(req: Request, res: Response): Promise<void> {
    try {
      const typeId = this.validateRequiredParam(req.params.typeId, 'Type ID');
      const taskType = await this.services!.taskType.updateTaskType(typeId, req.body);
      this.sendSuccess(res, taskType);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleDeleteTaskType(req: Request, res: Response): Promise<void> {
    try {
      const typeId = this.validateRequiredParam(req.params.typeId, 'Type ID');
      await this.services!.taskType.deleteTaskType(typeId);
      this.sendSuccess(res, { message: 'Task type deleted successfully' });
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleListTasks(req: Request, res: Response): Promise<void> {
    try {
      const filters: any = {
        status: req.query.status as string,
        typeId: req.query.typeId as string,
        assignedTo: req.query.assignedTo as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined
      };
      const projectId = this.validateRequiredParam(req.params.projectId, 'Project ID');
      const tasks = await this.services!.task.listTasks(projectId, filters);
      this.sendSuccess(res, tasks);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleCreateTask(req: Request, res: Response): Promise<void> {
    try {
      const task = await this.services!.task.createTask({
        ...req.body,
        projectId: req.params.projectId
      });
      this.sendSuccess(res, task, 201);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleCreateTasksBulk(req: Request, res: Response): Promise<void> {
    try {
      const projectId = this.validateRequiredParam(req.params.projectId, 'Project ID');
      const { tasks } = req.body;
      
      if (!Array.isArray(tasks)) {
        this.sendError(res, 'Tasks must be an array');
        return;
      }
      
      const result = await this.services!.task.createTasksBulk(projectId, tasks);
      this.sendSuccess(res, result, 201);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleGetTask(req: Request, res: Response): Promise<void> {
    try {
      const taskId = this.validateRequiredParam(req.params.taskId, 'Task ID');
      const task = await this.services!.task.getTask(taskId);
      if (!task) {
        this.sendError(res, 'Task not found', 404);
        return;
      }
      this.sendSuccess(res, task);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleUpdateTask(req: Request, res: Response): Promise<void> {
    try {
      const taskId = this.validateRequiredParam(req.params.taskId, 'Task ID');
      const task = await this.services!.task.updateTask(taskId, req.body);
      this.sendSuccess(res, task);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleDeleteTask(req: Request, res: Response): Promise<void> {
    try {
      const taskId = this.validateRequiredParam(req.params.taskId, 'Task ID');
      await this.services!.task.deleteTask(taskId);
      this.sendSuccess(res, { message: 'Task deleted successfully' });
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleListAgents(req: Request, res: Response): Promise<void> {
    try {
      const projectId = this.validateRequiredParam(req.params.projectId, 'Project ID');
      const agents = await this.services!.agent.listActiveAgents(projectId);
      this.sendSuccess(res, agents);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleCreateAgent(req: Request, res: Response): Promise<void> {
    // In lease-based model, agents don't need registration
    // This endpoint is deprecated but kept for API compatibility
    this.sendError(res, 'Agent registration not supported in lease-based model. Agents are created automatically when they request tasks.', 410);
  }

  private async handleGetAgent(req: Request, res: Response): Promise<void> {
    try {
      const agentName = this.validateRequiredParam(req.params.agentId, 'Agent Name');
      const projectId = this.validateRequiredParam(req.params.projectId, 'Project ID');
      const agent = await this.services!.agent.getAgentStatus(agentName, projectId);
      if (!agent) {
        this.sendError(res, 'Agent not found or not currently active', 404);
        return;
      }
      this.sendSuccess(res, agent);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleUpdateAgent(req: Request, res: Response): Promise<void> {
    // In lease-based model, agent state is not persistent/updatable
    this.sendError(res, 'Agent updates not supported in lease-based model. Agent state is managed through task leases.', 410);
  }

  private async handleDeleteAgent(req: Request, res: Response): Promise<void> {
    // In lease-based model, agents don't exist persistently to delete
    this.sendError(res, 'Agent deletion not supported in lease-based model. Agents are ephemeral.', 410);
  }

  private async handleGetNextTask(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.body;
      const agentName = this.validateRequiredParam(req.params.agentName, 'Agent Name');
      const task = await this.services!.agent.getNextTask(agentName, projectId);
      this.sendSuccess(res, task);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleCompleteTask(req: Request, res: Response): Promise<void> {
    try {
      const { agentName, projectId, result } = req.body;
      const taskId = this.validateRequiredParam(req.params.taskId, 'Task ID');
      const task = await this.services!.agent.completeTask(agentName, projectId, taskId, result);
      this.sendSuccess(res, task);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleFailTask(req: Request, res: Response): Promise<void> {
    try {
      const { agentName, projectId, error } = req.body;
      const taskId = this.validateRequiredParam(req.params.taskId, 'Task ID');
      const task = await this.services!.agent.failTask(agentName, projectId, taskId, error);
      this.sendSuccess(res, task);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleCleanupLeases(req: Request, res: Response): Promise<void> {
    try {
      const projectId = this.validateRequiredParam(req.params.projectId, 'Project ID');
      const result = await this.services!.lease.cleanupExpiredLeases(projectId);
      this.sendSuccess(res, result);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleExtendLease(req: Request, res: Response): Promise<void> {
    try {
      // Lease extension not implemented yet
      this.sendError(res, 'Lease extension not implemented', 501);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  private async handleGetSession(req: Request, res: Response): Promise<void> {
    // In the ephemeral agent model, we construct agent info from session data
    const agentInfo = req.session?.agentName ? {
      name: req.session.agentName,
      // Note: Other agent properties are not available in ephemeral model
    } : null;

    this.sendSuccess(res, {
      session: req.session,
      project: req.project,
      agent: agentInfo
    });
  }

  private async handleUpdateSession(req: Request, res: Response): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      const sessionToken = authHeader!.substring(7);
      
      const session = await this.services!.session.updateSessionData(sessionToken, req.body.data || {});
      this.sendSuccess(res, session);
    } catch (error: any) {
      this.sendError(res, error.message);
    }
  }

  // Helper methods
  private validateRequiredParam(value: string | undefined, name: string): string {
    if (!value) {
      throw new Error(`${name} is required`);
    }
    return value;
  }

  private sendSuccess<T>(res: Response, data: T, statusCode: number = 200): void {
    const response: ApiResponse<T> = {
      success: true,
      data,
      timestamp: new Date()
    };
    res.status(statusCode).json(response);
  }

  private sendError(res: Response, message: string, statusCode: number = 500, correlationId?: string): void {
    const response: ApiResponse<null> = {
      success: false,
      error: message,
      timestamp: new Date()
    };
    
    if (correlationId) {
      res.setHeader('X-Correlation-ID', correlationId);
    }
    
    res.status(statusCode).json(response);
  }
}