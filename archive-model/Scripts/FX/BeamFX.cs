using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using JetBrains.Annotations;
using Unity.Burst.CompilerServices;
using UnityEngine;
public class BeamFX : WeaponFXBasic
{
    public LineRenderer lineRenderer;
    public AnimationCurve lineLength;
    public AnimationCurve fade;
    private MaterialPropertyBlock propBlock;

    public float sphereOffsetFactor = 1;
    public Vector3 offsetFactor;

    public float brightness = 1;

    public bool madeContact = false;

    public override void FireAndRenderFx(Transform spawn, Transform target, Vector3 offset, ShipController shipOrigin, float dmg, float dmgMultiplier, int batchIndex)
    {
        _fired = true;
        _target = target;
        _origin = spawn;
        _damageMultiplier = dmgMultiplier;
        _damage = dmg;
        offsetFactor = UnityEngine.Random.insideUnitCircle * sphereOffsetFactor;

        _shipController = shipOrigin;

        _timing.Init();

        UpdatePosition();
    }

    protected override void Start()
    {
        propBlock = new MaterialPropertyBlock();
        //propBlock.GetFloat("_Fade_overall", fade.Evaluate(timing.GetProgressClamped));

        if (_target != null)
        {
            UpdatePosition();
        }

       // base.Start();
        if(selfAdd)
        {
            GameManager.Instance.AddSimulator(this);
        }

        if(GameManager.Instance.simulationController.SimulationState == SimulationState.Paused)
        {
            //StartSim();
            OnStopSim();
        }
    }

    public override void UpdateSim(float turnTimer, float frameTime)
    {

        //Debug.Log("updating weapon fx. " + deltaTime + " " + fired);
        if (_fired)
        {
            var offset = _target.position - _origin.position;
            var len = offset.magnitude;
            var direction = offset.normalized;
            var animationLen = len * lineLength.Evaluate(_timing.GetProgressClamped);

            animationLen = RaycastHitDetermineMaxLaserLen(direction, direction * animationLen + offsetFactor, animationLen);

            var directionAndMagnitude = direction * animationLen + offsetFactor;

            lineRenderer.SetPositions(new Vector3[] {
                _origin.position,
                _origin.position + directionAndMagnitude
            });

            // Apply the color and transparency to the property block
            propBlock.SetFloat("_Fade_overall", fade.Evaluate(_timing.GetProgressClamped) * brightness);

            // Set the property block of the renderer with the updated color
            lineRenderer.SetPropertyBlock(propBlock);

          

        }

        if (cleanupTiming.Completed())
        {
            GameManager.Instance.RemoveSimulator(this);
            //Destroy(gameObject);
            //StartCoroutine(cleanup());
        }
        //base.UpdateSim(turnTimer, frameTime);
    }

    float RaycastHitDetermineMaxLaserLen(Vector3 direction, Vector3 directionAndMagnitude, float animationLen)
    {
        //var hitColliders = new Collider[20];
        RaycastHit hit;
        if (Physics.Raycast(transform.position, direction, out hit, animationLen, _includesLayers))
        {
            // This code will run if the raycast hits something
            //Debug.Log("Hit: " + hit.collider.gameObject.name);
            if (!madeContact)//&& hit.collider.transform.tag != "Nav")
            {
                madeContact = true;
                Debug.Log($"hit object! {hit.collider.transform}");
                if (hit.collider.attachedRigidbody != null)
                {
                    var ship = hit.collider.attachedRigidbody.GetComponent<ShipController>();
                    bool spawnContactExplosion = true;
                    if (ship != null)
                    {
                        //Debug.Log($"weapon firing {Damage} with multiplier {damageMultiplier}");
                        var subsystem = hit.collider.transform.GetComponent<SubsystemColliderProxy>();
                        if (subsystem != null)
                        {
                            // absorb some damage
                            Debug.Log($"weapon firing @ subsystem {_damage} with multiplier {_damageMultiplier}");
                            subsystem.Damage(_damage * _damageMultiplier, new FiredEvent(){firedShip = _shipController });

                            if(subsystem.subsystemDamageTarget is ArmorPlating)
                            {
                                var armor = subsystem.subsystemDamageTarget;
                                if(armor.HealthPercent > 0)
                                {
                                    spawnContactExplosion = true;
                                }
                            }
                        } 
                        else
                        {
                            //Debug.Log($"weapon firing @ subsystem {Damage} with multiplier {damageMultiplier}");

                            ship.TakeDamage(_damage * _damageMultiplier, new FiredEvent(){firedShip = _shipController });
                        }
                    }
                    else
                    {
                        Debug.LogError("Warning! Ship is null, we shouldn't be handling this!");

                    }

                    if(spawnContactExplosion)
                    {
                        SpawnExplosion(_origin.position + directionAndMagnitude);
                    }
                }
                else{
                    SpawnExplosion(_origin.position + directionAndMagnitude);
                }
            }

            var hitLen = (_origin.position - (hit.point)).magnitude;

            return hitLen;
        }

        return animationLen;
    }

    protected override void SpawnExplosion(Vector3 location)
    {
        var exp = Instantiate(contactExplosion, location, Quaternion.identity);
        
    }

    protected override void UpdatePosition()
    {
        var offset = _target.position - _origin.position;
        var len = offset.magnitude;
        lineRenderer.SetPositions(new Vector3[] {
                _origin.position,
                _origin.position + offset.normalized * len * lineLength.Evaluate(_timing.GetProgressClamped),
            });
    }

}

