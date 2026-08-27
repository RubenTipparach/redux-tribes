using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Unity.VisualScripting;
using UnityEngine;
using System;
using Random = UnityEngine.Random;

[Serializable]
public class StealthDetectionBehavior{
    public bool EnableStealthDetection = false; // this will allow ships to determine if players are in line of sight.

    public Transform ScanForShipsOriginTransform;

    public List<Transform> patrolPoints;

    public int currentPatrolIndex = 0;
    public bool hasDetectedEnemy = false;

    public float patrolPointAdvanceThresh = 5f;

    public bool friendly = false;

    public bool justUseThisForPatrolOnlyLol = false;

    public Transform GetNextPatrolIndex(Vector3 currentShipPosition, float maxThrusterRangeValue)
    {
        if (patrolPoints.Count > 0)
        {
            var nextPatrolPoint = (currentPatrolIndex + 1) % patrolPoints.Count;
            var lastPatrolPoint = (currentPatrolIndex + (patrolPoints.Count - 1)) % patrolPoints.Count;

            var patrolTemp = patrolPoints[currentPatrolIndex];
            var distance = Vector3.Distance(currentShipPosition, patrolTemp.position);
            //Debug.Log($"current ship position {currentPatrolIndex} {currentShipPosition}, {patrolTemp.position} @distance {distance}");

            if (distance < maxThrusterRangeValue + patrolPointAdvanceThresh)
            {
                currentPatrolIndex = nextPatrolPoint;
            }
            else
            {
                //currentPatrolIndex = lastPatrolPoint;
            }

            return patrolTemp;
        }
        else
        {
            return null;
        }

    }

    public void ExtractPatrolPointsFromTransform(Transform patrolParent)
    {
         // TODO... upon extraction of patrol points, make sure to also clamp the distance among them. Might need some algorithm to handle this lol.
        patrolPoints = new List<Transform>();

        if (patrolParent != null)
        {

            foreach(Transform t in patrolParent)
            {
                patrolPoints.Add(t);
                //Debug.Log("loading waypoint " + t.gameObject.name);
            }
        }
    }
}

[RequireComponent(typeof(ShipController))]
[RequireComponent(typeof(VisionCone))]
[RequireComponent(typeof(ShipNavOverlay))]
[RequireComponent(typeof(ShapeSpaceUtilities))]
[RequireComponent(typeof(Rigidbody))]
public class BaseAIController : MonoBehaviour, ITimedSimulator
{
    public bool SimIsRunning { get; set; }

    public ShipController shipController;

    public float minDistancePercent = .25f;

    GameManager gm;

    public bool AIEnabled = true;

    public float raySpread = 15;
    public float rayScan = 180f;

    // TODO: define vision cone for my shippy for stealth missions.

    public LayerMask collisionDetectionMask;

    public StealthDetectionBehavior stealthDetectionBehavior;

    public Transform EZ_Waypoint_Parent_node;

    public VisionCone visionCone;

    public float artificialRangeAddition = 20f;
    public bool canChase = false;
    public List<Transform> MainObjectivePoint;
    public bool isFriendly = false;

    //public bool aggressiveStance = false;
    [Range(0,1f)]
    public float fireProbability = .5f; //doubles as agression levels.

    public float radialScanOffset = 10f;

    public void IfFiredUponAlert(ShipController shipFiring){
        // cant shoot myself lol
        if(shipController == shipFiring)
        {
            return;
        }

        // probably not shoot friends, but we can make this a threshold.
        if(isFriendly && shipFiring.isPlayerShip){
            return;
        }

        stealthDetectionBehavior.EnableStealthDetection = false;
        stealthDetectionBehavior.hasDetectedEnemy = true; // does this ship need to alert nearby ships?
        shipController.Targeting = shipFiring;

    }
    
    public void DisableAI(){
        AIEnabled = false;
        this.enabled = false;
        //Debug.LogError("AI was disabled");
    }

    public void EnableAI()
    {
        AIEnabled = true;
        this.enabled = true;
        // need to set AI stuff
        
    }

    public void BeforeSimmStop()
    {
        if (AIEnabled)
        {
            DoAIStuff();
        }
    }
    
    private void OnEnable() {
        //DoAIStuff();    
    }

    private void DoAIStuff()
    {
        Debug.Log("calculating AI stuff");
        if (shipController.isPlayerShip)
        {
            return; // we should get an override for this if players want to automate friendlys
        }

        // do movement, find ships? lol
        if (stealthDetectionBehavior.EnableStealthDetection && !stealthDetectionBehavior.hasDetectedEnemy)
        {
            var players = GameManager.Instance.ships.Where(x => x.isPlayerShip);
            foreach (var p in players)
            {
                Debug.Log($"scanning ship {p.transform.name}");
                visionCone.CheckTargetInVisionCone(p.transform);
            }
        }

        if (!stealthDetectionBehavior.EnableStealthDetection || stealthDetectionBehavior.hasDetectedEnemy)
        {
            //Debug.LogError($"{gameObject.name} has selected ship as a target");


            if (shipController.Targeting == null) // should go after the one it sees? but we can manage that in the other branch.
            {
                ShipController[] targetShips = null;
                if (!isFriendly)
                {
                    targetShips = gm.ships.Where(p => p.isPlayerShip && !p.Destroyed).ToArray();
                }
                else
                {
                    targetShips = gm.ships.Where(p => !p.isPlayerShip && !p.Destroyed).ToArray();
                }

                if (targetShips.Length > 0)
                {
                    shipController.SetTarget(targetShips[0]);
                }
                //Debug.LogError($"{gameObject.name} has selected ship as a target");
            }

            if (shipController.Targeting != null)
            {

                // var distanceRandom = Random.Range(minDistancePercent * shipController.MaxThrusterRange, shipController.MaxThrusterRange);
                // shipController.SetEstPosition(shipController.transform.position
                //     + Random.onUnitSphere * distanceRandom);

                // var rotationRandom = Random.rotation;
                // shipController.SetEstOrientation(rotationRandom);
                if (canChase)
                {
                    if (Vector3.Distance(shipController.Targeting.transform.position, transform.position) > shipController.maxThrusterRangeValue)
                    {
                        shipController.AIBoost = shipController.maxThrusterRangeValue + artificialRangeAddition;
                    }
                    else
                    {
                        shipController.AIBoost = 0;
                    }
                }

                int randomSecond = Random.Range(1, 9);
                shipController.ClearTargets(true);

                // we'll need to force more weapons based on aggression
                for (int i = 0; i < shipController.weapons.Count; i++)
                {
                    if (fireProbability < .2f)
                    {
                        shipController.QueueWeaponAttack(randomSecond, shipController.weapons[0]);
                    }
                    else
                    {
                        if (Random.Range(0, 1f) < fireProbability)
                        {
                            shipController.QueueWeaponAttack(randomSecond, shipController.weapons[i]);
                        }
                    }
                }

                var distanceRandom = Random.Range(minDistancePercent * shipController.MaxThrusterRange, shipController.MaxThrusterRange);

                // move towards player.'
                Vector3 nextPosition = transform.position;
                var hasObjectiveLocation = MainObjectivePoint != null && MainObjectivePoint.Count > 0;
                if (hasObjectiveLocation)
                {
                    //Debug.LogError($"{gameObject.name} has moved to obj");
                    nextPosition = MainObjectivePoint[0].position;
                    Debug.DrawLine(transform.position, MainObjectivePoint[0].position, Color.yellow, 10);
                }
                else
                {
                    //Debug.LogError($"{gameObject.name} has moved to random");
                    nextPosition = shipController.Targeting.transform.position
                        + Random.onUnitSphere * distanceRandom;
                }

                // If we detect a collision, rotate move position left or right simultaneously.
                //Debug.DrawLine(transform.position, nextPosition, Color.red, 10f);
                // TODO, search branching, allows ship to navigate complex obstacles.
                // avoid collisions.
                SweepRayCollisionDetection(transform.position, nextPosition, shipController);


                gm.SnapRotationToTarget(shipController);

                var rotationRandom = Random.rotation;
                if (hasObjectiveLocation)
                {
                    MoveTowardsObjective();
                }
                else
                {
                    if (Vector3.Distance(shipController.Targeting.transform.position, transform.position) > shipController.MaxThrusterRange * .5f)
                    {
                        rotationRandom = Quaternion.LookRotation(
                            (shipController.shipMovementEstimator.transform.position - transform.position).normalized, Vector3.up);
                    }
                    shipController.SetEstOrientation(rotationRandom);
                }

            }
        }
        // no ships found continue with movement along patrol path
        else
        {
            var hasObjectiveLocation = MainObjectivePoint != null && MainObjectivePoint.Count > 0;

            // navigate towards the next waypoint.            
            if (hasObjectiveLocation)
            {
                MoveTowardsObjective();
            }
            else
            {
                DoWaypoints();
            }
        }

        if (stealthDetectionBehavior.justUseThisForPatrolOnlyLol)
        {
            DoWaypoints();
        }

    }


    private void DoWaypoints()
    {
        var nextWaypoint = stealthDetectionBehavior.GetNextPatrolIndex(shipController.transform.position, shipController.MaxThrusterRange);

        if (nextWaypoint != null)
        {
            shipController.SetEstPosition(nextWaypoint.transform.position);
            var directionLook = (nextWaypoint.transform.position - transform.position).normalized;
            var rotation = Quaternion.LookRotation(directionLook, Vector3.up);
            //Debug.Log("ship should face this direction " + directionLook);
            //Debug.DrawLine(transform.position, transform.position + rotation * Vector3.forward * 10, Color.red, 10f);
            shipController.SetEstOrientation(rotation);
        }
        else
        {
            shipController.SelectFullStop();
        }
    }
    private void MoveTowardsObjective()
    {
        var nextPosition = MainObjectivePoint[0].position;
        Debug.DrawLine(transform.position, MainObjectivePoint[0].position, Color.green, 10);
        shipController.SetEstPosition(nextPosition);
        var directionLook = (nextPosition - transform.position).normalized;
        var rotation = Quaternion.LookRotation(directionLook, Vector3.up);
        shipController.SetEstOrientation(rotation);
    }

    private void SweepRayCollisionDetection(Vector3 origin, Vector3 nextPosition, ShipController shipController)
    {
        // lets do a 5 degree spread for a total of 18 rays per side (total of 180 degrees.)
        //.RaycastHit hit;
        var temp = (nextPosition - origin).normalized;
        Vector3 offset = temp * shipController.MaxThrusterRange;
        Quaternion offsetRotation = Quaternion.LookRotation(offset, Vector3.up);

        bool safePositionFound = false;
        // estimate ship size to be 30f ish
        float shipSize = 10f;
        float maxDetectionDistance = offset.magnitude + shipSize;

        shipController.SetEstPosition(nextPosition);

        int verticalStart = 0;
        int verticalEnd = 45;
        int verticalIncrement = 15;


        for (int i = verticalStart; i <= verticalEnd; i += verticalIncrement)
        {
            int verticalAngle = i; // from -45 to 45, increment by 15 
            bool result = false;
            if (i > 0 && i % 2 == 1)
            {
                //scan up
                verticalAngle = -verticalAngle;
            }
            //Debug.Log($"checking collision vertical {i}");

            // alternate to scan down.
            result = ScanHorizon(
                verticalAngle: verticalAngle,
                offset: offset,
                origin: origin,
                shipSize: shipSize,
                maxDetectionDistance: maxDetectionDistance,
                safePositionFound: safePositionFound);
            if (result)
            {
                //Debug.Log("detected no collision");
                break;
            }
        }

    }

    private bool ScanHorizon(int verticalAngle, Vector3 offset, Vector3 origin, float shipSize, float maxDetectionDistance, bool safePositionFound)
    {
        int horizontalStart = 0;
        int horizontalEnd = 9; //180
        int horizontalIncrement = 1; // 20, -20

        for (int j = horizontalStart; j < horizontalEnd; j += horizontalIncrement)
        {
            int horizontalAngle = j * 20;
            if(j%2 == 1)
            {
                horizontalAngle = -horizontalAngle;
            }

            var result = Scan( // TODO: AI ray cast origin should come from front/back origin points, we should avoid center of object.
                verticalAngle: verticalAngle,
                horizontalAngle: horizontalAngle,
                offset: offset,
                origin: origin,
                shipSize: shipSize,
                maxDetectionDistance: maxDetectionDistance,
                safePositionFound: safePositionFound);

                if(result)
                {
                    return true;
                }
        }

        return false;
    }

    private bool Scan(int verticalAngle, int horizontalAngle, Vector3 offset, Vector3 origin, float shipSize, float maxDetectionDistance, bool safePositionFound){
            //Vector3 direction = Quaternion.Euler(verticalAngle, horizontalAngle, 0) * Vector3.forward;
            Vector3 direction =
                (Quaternion.LookRotation(offset.normalized, Vector3.up) * Quaternion.Euler(verticalAngle, horizontalAngle, 0)) * Vector3.forward;
            RaycastHit hit;
        origin = origin + direction * radialScanOffset;

            if (!Physics.SphereCast(origin: origin,
                radius: shipSize,
                direction: direction,
                out hit,
                maxDistance: maxDetectionDistance,
                layerMask: collisionDetectionMask))
            {
                // No obstacle detected in this direction

                Debug.DrawRay(origin, direction * maxDetectionDistance, Color.green, 10f);
                safePositionFound = true;

                shipController.SetEstPosition(origin + direction * offset.magnitude);

                return safePositionFound;
            }
            else
            {
                // Obstacle detected, draw the ray in red
                Debug.DrawRay(origin, direction * hit.distance, Color.red, 10f);
                return false;
            }
    }

    public void BeforeSimStart()
    {
        if(GameManager.Instance.currentTurnNumber == 0)
        {
            DoAIStuff();// initialize AI movements.
        }
    }

    public void DestroySim()
    {
    }

    public void OnStartSim()
    {


    }

    public void OnStopSim()
    {
    }

    public void UpdateSim(float turnTimer, float frameTime)
    {
        // need to simulate player ship detection behavior.
    }

    // Start is called before the first frame update
    void Start()
    {
        shipController = GetComponent<ShipController>();
        gm = GameManager.Instance;

        gm.AddSimulator(this);

        stealthDetectionBehavior.ExtractPatrolPointsFromTransform(EZ_Waypoint_Parent_node);
        shipController.isFriendly = isFriendly;
        DoAIStuff();// initialize AI movements. why did I comment this out?
    }

    
    // Update is called once per frame
    void Update()
    {
        
    }
#if UNITY_EDITOR
    void OnDrawGizmos()
    {
        Gizmos.color = Color.blue;
        Gizmos.DrawWireSphere(transform.position, radialScanOffset);
    }
    #endif
}

