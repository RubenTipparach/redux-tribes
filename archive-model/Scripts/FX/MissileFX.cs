using System;
using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;


public class MissileFX : WeaponFXBasic
{
    public int quantity = 10;
    public int max = 15;

    public SimVector3Update movementDescriptor;

    public Transform movementEstimator;

    //public float rallyDistance = 40f;
    public float errorRadius = 2.5f; // define accuracy.
    public float errorRadius2 = .5f; // define accuracy.

    public float gameTimeStartedSecond = 0;

    public float lastProgressSecond = 0;

    public float MaxManeuveringTimer = 1;

    public float launchSpeed = 10;
    public float accelerateSpeed = 20;

    //public float[] errorRadii;
    public int currentErrorIndex = 0;
    public TrailRenderer trailRenderer;
    public bool launching = true;
    bool destroyed = false;
    float pauseTime = 0;
    float resumeTime = 0;

    public float trailTime = 5;

    public ShipController _targetShip;
    public ShipSubsystem _targetSubsystem;

    public bool LaunchMode = true;


    public Transform rayCastPosition;

    public override void FireAndRenderFx(Transform originPoint, Transform targetPosition, Vector3 zero, ShipController shipOrigin, float damage, float dmgMultiplier, int batchIndex)
    {
        _fired = true;
        _target = targetPosition;
        _origin = originPoint;
        _damageMultiplier = dmgMultiplier;
        _damage = damage;
        //offsetFactor = UnityEngine.Random.insideUnitCircle * sphereOffsetFactor;

        _shipController = shipOrigin;
        transform.parent = null;
        _timing.Init();
        lastPosition = rayCastPosition.position;

        _targetShip = _target.gameObject.GetComponent<ShipController>();
        if (_targetShip == null)
        {
            _targetSubsystem = _target.GetComponent<ShipSubsystem>();
            _targetShip = _targetSubsystem.ship;
        }

        UpdatePosition();

        var offsetOfTarget = transform.position - originPoint.position;
        var directionOfWeapon = offsetOfTarget.normalized;
        var direction = originPoint.forward;
        var rallyPosition = originPoint.position + direction * launchSpeed
            + errorRadius * UnityEngine.Random.insideUnitSphere;
        // set movement estimator parameters.
        movementEstimator.transform.position = rallyPosition;
        movementEstimator.transform.rotation = Quaternion.LookRotation(direction);

        // set manuevering parameter
        movementDescriptor = new SimVector3Update();
        //movementDescriptor.ManuallySetSlideVector(originPoint.position + direction );//* launchSpeed);
        movementDescriptor.StartSim(originPoint.position, rallyPosition);

        Debug.DrawLine(originPoint.position, rallyPosition, Color.green, 10f);

        currentErrorIndex = 1;
        gameTimeStartedSecond = GameManager.Instance.masterTime;
        lastProgressSecond = 0;


        lastKnownPosition = transform.position;
        Debug.Log("Firing Missile WEAPON!");

    }

    protected override void Start()
    {

        if (_target != null)
        {
            UpdatePosition();
        }

        if(selfAdd)
        {
            GameManager.Instance.AddSimulator(this);
            Debug.Log(gameObject.name + " added as particle sim");
        }

        if(GameManager.Instance.simulationController.SimulationState == SimulationState.Paused)
        {
            //StartSim();
            OnStopSim();
        }
    }



    public override void OnStartSim()
    {
        movementEstimator.gameObject.SetActive(false);

        cleanupTiming.Resume();
        if (particles!= null && !particles.isPlaying && GameManager.Instance.simulationController.SimulationState == SimulationState.Simulating)
        {
            particles.Play();
        }

        resumeTime = Time.time;
        
        trailRenderer.time = (resumeTime - pauseTime) + trailTime;
        // trailRenderer.time = trailTime;

        SimIsRunning = true;

        if (debug)
        {
            Debug.Log("starring sim " + transform.name);
        }
    }

    public override void OnStopSim()
    {
        //movementEstimator.gameObject.SetActive(true);

        if (particles != null)
        {
            particles.Pause(true);
            //Debug.Log($"particles paused {transform.name}");
            //particles.li
        }

        cleanupTiming.Pause();

        pauseTime = Time.time;
        trailRenderer.time = Mathf.Infinity;

        SimIsRunning = false;
        if(debug)
        {
            Debug.Log("stopping sim " + transform.name);
        }
    }

    public float firingSpeed = 100;
    public Vector3 lastKnownPosition = Vector3.zero;
    public override void UpdateSim(float turnTimer, float frameTime)
    {
        //Debug.Log( gameObject.name + " updating weapon fx. " + deltaTime + " " + _fired);
        if (_fired && weaponFx.activeInHierarchy)
        {
            //var velocity = Vector3.forward * firingSpeed * frameTime;

            var velocity = transform.forward * 2;
            if (RaycastHitDetermineMaxLaserLen(velocity, out RaycastHit hit))
            {
                if (!collisionCheck)
                {
                    CollisionCheckProcedure(hit.collider);
                }
            }
            //transform.Translate(velocity, Space.Self);
            // move


            // track timer
            if (lastProgressSecond >= MaxManeuveringTimer)
            {
                launching = false;

                // if we reach max seconds, restart clock and choose new location.
                // set movement estimator parameters.
                var previousPosition = transform.position;

                var offsetOfTarget = _target.position - previousPosition;
                var directionOfWeapon = offsetOfTarget.normalized;
                if (_targetShip == null || !_targetShip.shipHealth.IsDead)
                {
                    movementEstimator.transform.position = transform.position + directionOfWeapon * accelerateSpeed
                        + errorRadius2 * UnityEngine.Random.insideUnitSphere; // tee hee add error radius
                    movementEstimator.transform.rotation = Quaternion.LookRotation(directionOfWeapon);
                }
                else
                {
                    movementEstimator.transform.position = movementEstimator.transform.position + transform.forward * accelerateSpeed
                       + errorRadius2 * UnityEngine.Random.insideUnitSphere;
                }

                // set manuevering parameter
                //movementDescriptor.ManuallySetSlideVector( previousPosition + direction * launchSpeed);
                movementDescriptor.StartSim(previousPosition, movementEstimator.transform.position);
                lastProgressSecond = lastProgressSecond - MaxManeuveringTimer;
            }

            // increment timer. (this is only called when simulation is running.)
            lastProgressSecond += frameTime;

            // reset progress.
            float movedPercent = lastProgressSecond / MaxManeuveringTimer;

            // Debug.Log($" missile update: {lastProgressSecond} / {MaxManeuveringTimer}");

            transform.position = movementDescriptor.UpdateSim(movedPercent);
            transform.rotation = Quaternion.LookRotation((transform.position - lastKnownPosition).normalized);
            //Debug.DrawLine(transform.position, lastKnownPosition, Color.red, 5f);
            lastKnownPosition = transform.position;
        }



        base.UpdateSim(turnTimer, frameTime);

        lastPosition = rayCastPosition.position;
    }

    bool RaycastHitDetermineMaxLaserLen(Vector3 velocity, out RaycastHit hitTarget)
    {
        RaycastHit hit;
        if (Physics.Raycast(transform.position, velocity.normalized, out hit, velocity.magnitude, _includesLayers))
        {
            if (HitTargetDetection(hit))
            {
                hitTarget = hit;
                return true;
            }
        }

        hitTarget = hit;
        return false;
        
    }


    public override void DestroySim()
    {
        if (debug)
        {
            Debug.Log("clean up sim " + transform.name);
        }

        if(!destroyed && !collisionCheck)
        {
            Instantiate(contactExplosion, transform.position, Quaternion.identity);
        }

        destroyed = true;

        Destroy(gameObject);
    }

    bool collisionCheck = false;
    private void OnCollisionEnter(Collision other) 
    {
        Debug.Log("missile entered");
       CheckCollision(other);
    }

    private void OnCollisionStay(Collision other) 
    {
        CheckCollision(other);
    }

    private void OnCollisionExit(Collision other) {
        Debug.Log("missile exited");
        CheckCollision(other);
    }

    private void CheckCollision(Collision other)
    {
        var mask = _includesLayers | 1 << other.transform.gameObject.layer;

        //Debug.Log($"other collision {other.transform.name} check {collisionCheck} mask {(int)_includesLayers}=={mask}");

        if (!collisionCheck
            &&
            (_includesLayers == mask))
        {
            var collider = other.collider;
            //StartCoroutine(CollisionDamage());
            CollisionCheckProcedure(collider);
        }
    }

    private void CollisionCheckProcedure(Collider collider)
    {

        if (collider.attachedRigidbody != null)
        {
            var ship = collider.attachedRigidbody.GetComponent<ShipController>();
            if (ship != null && ship != _shipController) // avoid damaging own ship.
            {
                bool spawnContactExplosion = false;
                //Debug.Log($"{transform.name} weapon firing {_damage} * multiplier {_damageMultiplier}");
                PerformDamageProcedure(collider, ref spawnContactExplosion, ship);
            }
        }
        var myShipHit = collider.attachedRigidbody == null ? null : collider.attachedRigidbody.GetComponent<ShipController>();

        if (myShipHit != null && myShipHit == _shipController)
        {
            return;
        }

        collisionCheck = true;
        // else the missile should just explode lol.
        Instantiate(contactExplosion, transform.position, Quaternion.identity);
        weaponFx.SetActive(false);
        GetComponent<Collider>().enabled = false;
        GameManager.Instance.RemoveSimulator(this);
    }


    protected override void UpdatePosition()
    {
        transform.position = _origin.position;
        Vector3 direction = _target.position - _origin.position;
        var rotation = Quaternion.LookRotation(direction.normalized);
        transform.rotation = rotation;
    }
}
